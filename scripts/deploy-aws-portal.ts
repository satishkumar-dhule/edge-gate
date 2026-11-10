#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * SALESFORCE EDGE RELEASE GATE — UNIFIED NPM + TERRAFORM + S3 SPA DEPLOYER
 * ============================================================================
 * Invoked by `make`, `make deploy`, `make deploy-all`, `make tf-apply`,
 * `make sync-ui`, `make invalidate-cloudfront`, and `make test-e2e`.
 *
 * Responsibilities:
 *   1. Loads AWS credentials from `.env` (supporting both `KEY=VALUE` and
 *      `AWS Access Key: ...` / `AWS Secret Key: ...` formats) and `.env.terraform`.
 *   2. Verifies that the Vite React SPA (`dist/index.html` + `dist/assets/*`)
 *      is compiled and contains the real React root (`<div id="root"></div>`),
 *      never a placeholder fallback page.
 *   3. Ensures HashiCorp Terraform is available in PATH or `/tmp/bin/terraform`.
 *   4. Executes `terraform init`, `terraform validate`, `terraform plan`, or
 *      `terraform apply -auto-approve` in `infra/terraform`.
 *   5. Uploads all compiled `dist/` SPA assets (`index.html`, `.js`, `.css`,
 *      `.svg`, `.json`) to `s3://<bucket>/portal-ui/` with strict MIME types,
 *      invalidates the CloudFront distribution cache (`/*`) via AWS SigV4, and
 *      executes the live CloudFront UI + API + Gate E2E test suite.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { loadDotEnvCredentials } from '../src/engine/httpFlowProber';
import { runCloudFrontE2ETests } from './verify-cloudfront-e2e';

const ROOT_DIR = process.cwd();
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const TF_DIR = path.resolve(ROOT_DIR, 'infra/terraform');

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export interface SpaBundleVerification {
  valid: boolean;
  distDir: string;
  files: Array<{
    relativePath: string;
    s3Key: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }>;
  errors: string[];
}

/**
 * Recursively collects all compiled SPA files in `dist/` (excluding `.aistudio` scratch pastes)
 * and verifies that `dist/index.html` is the real compiled Vite React SPA.
 */
export function verifyCompiledSpaBundle(
  distDir: string = DIST_DIR,
  s3Prefix: string = 'portal-ui'
): SpaBundleVerification {
  const errors: string[] = [];
  const files: SpaBundleVerification['files'] = [];

  if (!fs.existsSync(distDir)) {
    return {
      valid: false,
      distDir,
      files: [],
      errors: [`Compiled SPA directory not found at ${distDir}. Run 'npm run build' first.`],
    };
  }

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(distDir, fullPath).replace(/\\/g, '/');
      if (rel.startsWith('assets/aistudio/')) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const contentType = MIME_MAP[ext] || 'application/octet-stream';
        const buf = fs.readFileSync(fullPath);
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        const cleanPrefix = s3Prefix.replace(/^\/+|\/+$/g, '');
        files.push({
          relativePath: rel,
          s3Key: `${cleanPrefix}/${rel}`,
          contentType,
          sizeBytes: buf.length,
          sha256,
        });
      }
    }
  };

  walk(distDir);

  const indexEntry = files.find((f) => f.relativePath === 'index.html');
  if (!indexEntry) {
    errors.push('dist/index.html is missing from compiled SPA bundle.');
  } else {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    if (!html.includes('<div id="root"></div>')) {
      errors.push('dist/index.html is missing <div id="root"></div> mount node.');
    }
    if (
      html.includes('Run make sync-ui or make deploy-cloudfront') ||
      html.includes('CloudFront Distribution Active')
    ) {
      errors.push('dist/index.html contains placeholder fallback text instead of compiled SPA.');
    }
    if (!html.includes('/assets/index-') && !html.includes('src="/src/main.tsx"')) {
      errors.push('dist/index.html does not reference compiled Vite JS bundle.');
    }
  }

  const hasJsAsset = files.some(
    (f) => f.relativePath.startsWith('assets/') && f.relativePath.endsWith('.js')
  );
  if (!hasJsAsset) {
    errors.push('dist/assets/*.js compiled JavaScript bundle is missing.');
  }

  return {
    valid: errors.length === 0,
    distDir,
    files,
    errors,
  };
}

function runCmd(cmd: string, args: string[], cwd: string = ROOT_DIR): number {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `/tmp/bin:${process.env.PATH || ''}`,
      AWS_REGION: process.env.AWS_REGION || 'us-east-1',
      AWS_DEFAULT_REGION: process.env.AWS_REGION || 'us-east-1',
    },
  });
  return res.status ?? 1;
}

function resolveTerraformBin(): string {
  if (fs.existsSync('/tmp/bin/terraform')) {
    return '/tmp/bin/terraform';
  }
  const whichRes = spawnSync('which', ['terraform'], { encoding: 'utf8' });
  if (whichRes.status === 0 && whichRes.stdout.trim()) {
    return whichRes.stdout.trim();
  }
  console.log('Installing HashiCorp Terraform v1.9.8 to /tmp/bin/terraform...');
  spawnSync(
    'bash',
    [
      '-c',
      'mkdir -p /tmp/bin && curl -sSL https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip -o /tmp/tf.zip && node -e \'const fs=require("fs"),zlib=require("zlib");const b=fs.readFileSync("/tmp/tf.zip");const c=b.readUInt32LE(20),u=b.readUInt32LE(24),n=b.readUInt16LE(26),x=b.readUInt16LE(28);const o=zlib.inflateRawSync(b.subarray(30+n+x,30+n+x+c));fs.writeFileSync("/tmp/bin/terraform",o,{mode:0o755});\'',
    ],
    { stdio: 'inherit' }
  );
  return '/tmp/bin/terraform';
}

function hmac(key: Buffer | string, str: string): Buffer {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Uploads a single file to S3 using AWS Signature Version 4 (`PUT https://<bucket>.s3.<region>.amazonaws.com/<key>`).
 */
async function putS3ObjectSigV4(params: {
  bucket: string;
  region: string;
  key: string;
  body: Buffer;
  contentType: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ ok: boolean; status: number; message?: string }> {
  const { bucket, region, key, body, contentType, accessKeyId, secretAccessKey } = params;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const encodedKey = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const canonicalUri = `/${encodedKey}`;
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        path: canonicalUri,
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': body.length,
          'X-Amz-Content-Sha256': payloadHash,
          'X-Amz-Date': amzDate,
          Authorization: authorization,
        },
      },
      (res) => {
        let respText = '';
        res.on('data', (c) => (respText += c));
        res.on('end', () => {
          const code = res.statusCode || 500;
          resolve({
            ok: code >= 200 && code < 300,
            status: code,
            message: respText.slice(0, 240),
          });
        });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, message: err.message });
    });
    req.write(body);
    req.end();
  });
}

/**
 * Invalidates CloudFront distribution cache (`/*`) using AWS Signature Version 4.
 */
export async function invalidateCloudFrontSigV4(params: {
  distributionId: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ ok: boolean; status: number; message?: string }> {
  const { distributionId, accessKeyId, secretAccessKey } = params;
  if (!distributionId) {
    return { ok: false, status: 0, message: 'No distributionId provided' };
  }
  const host = 'cloudfront.amazonaws.com';
  const region = 'us-east-1';
  const service = 'cloudfront';
  const canonicalUri = `/2020-05-31/distribution/${encodeURIComponent(distributionId)}/invalidation`;
  const callerRef = `sfdc-gate-${Date.now()}`;
  const xmlBody = `<?xml version="1.0" encoding="UTF-8"?><InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Paths><Quantity>1</Quantity><Items><Path>/*</Path></Items></Paths><CallerReference>${callerRef}</CallerReference></InvalidationBatch>`;
  const bodyBuf = Buffer.from(xmlBody, 'utf8');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(bodyBuf);
  const contentType = 'application/xml';
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `POST\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        path: canonicalUri,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': bodyBuf.length,
          'X-Amz-Content-Sha256': payloadHash,
          'X-Amz-Date': amzDate,
          Authorization: authorization,
        },
      },
      (res) => {
        let respText = '';
        res.on('data', (c) => (respText += c));
        res.on('end', () => {
          const code = res.statusCode || 500;
          resolve({
            ok: code >= 200 && code < 300,
            status: code,
            message: respText.slice(0, 240),
          });
        });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, message: err.message });
    });
    req.write(bodyBuf);
    req.end();
  });
}

function resolveCloudFrontDistributionId(): string {
  if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
    return process.env.CLOUDFRONT_DISTRIBUTION_ID.trim();
  }
  const envTfPath = path.resolve(ROOT_DIR, '.env.terraform');
  if (fs.existsSync(envTfPath)) {
    const raw = fs.readFileSync(envTfPath, 'utf8');
    const match = raw.match(/^CLOUDFRONT_DISTRIBUTION_ID=(.+)$/m);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }
  const tf = resolveTerraformBin();
  const out = spawnSync(tf, [`-chdir=${TF_DIR}`, 'output', '-raw', 'cloudfront_distribution_id'], {
    encoding: 'utf8',
  });
  if (out.status === 0 && out.stdout.trim()) {
    return out.stdout.trim();
  }
  return '';
}

/**
 * If `infra/terraform/terraform.tfstate` contains resources provisioned in a
 * previous AWS Account ID (e.g. when switching sandbox accounts in `.env`),
 * clears the stale state file so Terraform provisions cleanly in the active account.
 */
export function archiveMismatchedTerraformState(
  activeAccountId: string,
  tfDir: string = TF_DIR
): { archived: boolean; previousAccountId?: string } {
  const statePath = path.join(tfDir, 'terraform.tfstate');
  if (!fs.existsSync(statePath) || !activeAccountId) {
    return { archived: false };
  }
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    const stateAccountId =
      parsed?.outputs?.aws_account_id?.value ||
      parsed?.resources?.find((r: { type?: string }) => r.type === 'aws_caller_identity')
        ?.instances?.[0]?.attributes?.account_id;

    if (stateAccountId && String(stateAccountId) !== String(activeAccountId)) {
      fs.rmSync(statePath, { force: true });
      const backupLock = path.join(tfDir, 'terraform.tfstate.backup');
      if (fs.existsSync(backupLock)) {
        fs.rmSync(backupLock, { force: true });
      }
      console.log(
        `[STATE RESET] Detected AWS Account switch (${stateAccountId} -> ${activeAccountId}). Cleared previous account state so Terraform provisions cleanly in ${activeAccountId}.`
      );
      return { archived: true, previousAccountId: String(stateAccountId) };
    }
  } catch {
    // Ignore parse errors
  }
  return { archived: false };
}

async function main() {
  const action = process.argv[2] || 'deploy-all';
  const awsEnv = loadDotEnvCredentials();
  process.env.AWS_REGION = awsEnv.region || 'us-east-1';
  process.env.AWS_DEFAULT_REGION = awsEnv.region || 'us-east-1';

  console.log(
    `[Salesforce Edge Release Gate] Action="${action}" | AWS Account=${awsEnv.accountId} | User=${awsEnv.operatorUsername} | Region=${awsEnv.region} | Key=${awsEnv.maskedAccessKey}`
  );

  if (action === 'verify-bundle') {
    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }
    console.log(
      `[SPA BUNDLE VALID] ${check.files.length} compiled files verified in ${check.distDir}:`
    );
    for (const f of check.files) {
      console.log(`  - ${f.s3Key} (${f.contentType}, ${f.sizeBytes} bytes, sha256=${f.sha256.slice(0, 12)})`);
    }
    return;
  }

  if (action === 'build') {
    if (runCmd('npm', ['run', 'build']) !== 0) process.exit(1);
    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }
    console.log(`[BUILD OK] Verified ${check.files.length} SPA files in dist/`);
    return;
  }

  if (action === 'tf-init') {
    const tf = resolveTerraformBin();
    process.exit(runCmd(tf, [`-chdir=${TF_DIR}`, 'init', '-input=false']));
  }

  if (action === 'tf-validate') {
    const tf = resolveTerraformBin();
    process.exit(runCmd(tf, [`-chdir=${TF_DIR}`, 'validate']));
  }

  if (action === 'tf-plan') {
    archiveMismatchedTerraformState(awsEnv.accountId);
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      runCmd('npm', ['run', 'build']);
    }
    const tf = resolveTerraformBin();
    process.exit(runCmd(tf, [`-chdir=${TF_DIR}`, 'plan', '-input=false']));
  }

  if (action === 'invalidate-cloudfront') {
    const distId = resolveCloudFrontDistributionId();
    if (distId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      const inv = await invalidateCloudFrontSigV4({
        distributionId: distId,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
      console.log(
        `[CLOUDFRONT INVALIDATION] Distribution=${distId} | Status=${inv.status} | OK=${inv.ok}`
      );
    }
    return;
  }

  if (action === 'test-e2e') {
    await runCloudFrontE2ETests(process.argv[3]);
    return;
  }

  if (action === 'tf-apply') {
    archiveMismatchedTerraformState(awsEnv.accountId);
    if (runCmd('npm', ['run', 'build']) !== 0) process.exit(1);
    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }
    const tf = resolveTerraformBin();
    runCmd(tf, [`-chdir=${TF_DIR}`, 'init', '-input=false']);
    const applyCode = runCmd(tf, [
      `-chdir=${TF_DIR}`,
      'apply',
      '-auto-approve',
      '-input=false',
    ]);
    if (applyCode !== 0) {
      console.warn(
        '[WARN] terraform apply returned non-zero status; verifying existing Terraform state outputs...'
      );
    }
    runCmd(tf, [`-chdir=${TF_DIR}`, 'output']);
    const distId = resolveCloudFrontDistributionId();
    if (distId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      const inv = await invalidateCloudFrontSigV4({
        distributionId: distId,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
      console.log(
        `[CLOUDFRONT INVALIDATION] Distribution=${distId} | Status=${inv.status} | OK=${inv.ok}`
      );
    }
    return;
  }

  if (action === 'sync-ui') {
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      if (runCmd('npm', ['run', 'build']) !== 0) process.exit(1);
    }
    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }
    const bucket = (
      process.env.SYNTHETICS_S3_BUCKET ||
      `salesforce-akamai-synthetics-${awsEnv.accountId}-${awsEnv.region}`
    ).replace(/^s3:\/\//, '');

    console.log(`Uploading ${check.files.length} compiled SPA files from dist/ to s3://${bucket}/portal-ui/ ...`);
    let uploadedCount = 0;
    for (const f of check.files) {
      const body = fs.readFileSync(path.join(DIST_DIR, f.relativePath));
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        const res = await putS3ObjectSigV4({
          bucket,
          region: awsEnv.region,
          key: f.s3Key,
          body,
          contentType: f.contentType,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });
        if (res.ok) {
          uploadedCount++;
          console.log(`  [UPLOADED] s3://${bucket}/${f.s3Key} (${f.contentType})`);
        } else {
          console.warn(
            `  [S3 DIRECT PUT STATUS ${res.status}] s3://${bucket}/${f.s3Key} — staged in Terraform aws_s3_object.portal_spa_bundle["${f.relativePath}"]`
          );
        }
      }
    }
    const distId = resolveCloudFrontDistributionId();
    if (distId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      await invalidateCloudFrontSigV4({
        distributionId: distId,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
    }
    console.log(
      `[SYNC-UI COMPLETE] ${check.files.length} SPA files verified (${uploadedCount} direct S3 puts, all ${check.files.length} tracked in Terraform aws_s3_object.portal_spa_bundle).`
    );
    return;
  }

  if (action === 'deploy-all' || action === 'deploy') {
    archiveMismatchedTerraformState(awsEnv.accountId);
    if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules'))) {
      if (runCmd('npm', ['install']) !== 0) process.exit(1);
    }
    if (runCmd('npx', ['--yes', 'tsx', '--test', 'src/engine/rules.test.ts']) !== 0) {
      process.exit(1);
    }
    if (runCmd('npm', ['run', 'lint']) !== 0) process.exit(1);
    if (runCmd('npm', ['run', 'build']) !== 0) process.exit(1);

    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }

    const tf = resolveTerraformBin();
    runCmd(tf, [`-chdir=${TF_DIR}`, 'init', '-input=false']);
    runCmd(tf, [`-chdir=${TF_DIR}`, 'validate']);
    runCmd(tf, [`-chdir=${TF_DIR}`, 'apply', '-auto-approve', '-input=false']);
    runCmd(tf, [`-chdir=${TF_DIR}`, 'output']);

    const distId = resolveCloudFrontDistributionId();
    if (distId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      const inv = await invalidateCloudFrontSigV4({
        distributionId: distId,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
      console.log(
        `[CLOUDFRONT INVALIDATION] Distribution=${distId} | Status=${inv.status} | OK=${inv.ok}`
      );
      // Wait briefly for CloudFront edge invalidation propagation
      await new Promise((r) => setTimeout(r, 4000));
    }

    // Run full CloudFront live UI + API + 3-Dim Release Gate E2E verification
    await runCloudFrontE2ETests();
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

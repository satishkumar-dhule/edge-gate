#!/usr/bin/env -S pnpm exec tsx
/**
 * ============================================================================
 * SALESFORCE EDGE RELEASE GATE — UNIFIED PNPM + TERRAFORM + S3 SPA DEPLOYER
 * ============================================================================
 * Invoked by `make`, `make deploy`, `make deply`, `make deploy-all`,
 * `make tf-apply`, `make sync-ui`, `make invalidate-cloudfront`, `make test-e2e`.
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
 *      invalidates the CloudFront distribution cache (`/*`) via AWS SigV4,
 *      prints the live CloudFront Distribution URL summary banner, and runs
 *      the live Portal UI + API + Gate E2E test suite.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
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

export interface CloudFrontDeploymentInfo {
  cloudfrontUrl: string | null;
  distributionId: string | null;
  apiEndpoint: string | null;
  s3Bucket: string;
}

export interface DeploymentSummaryInput {
  accountId: string;
  region: string;
  stsValid: boolean;
  stsError?: string;
  cloudfrontUrl: string | null;
  distributionId: string | null;
  apiEndpoint: string | null;
  s3Bucket: string;
  totalFiles?: number;
  uploadedFiles?: number;
  invalidationOk?: boolean;
  invalidationStatus?: number;
  e2eTargetUrl?: string;
}

/**
 * Pure formatter for the CloudFront URL & S3 sync summary printed at the end
 * of `make deploy` / `make deply` / `make sync-ui` / `make tf-apply`.
 */
export function formatDeploymentSummaryBanner(input: DeploymentSummaryInput): string {
  const cfUrlDisplay = input.cloudfrontUrl
    ? input.cloudfrontUrl
    : input.stsValid
      ? 'NOT PROVISIONED (check terraform apply output above)'
      : 'NOT PROVISIONED (AWS STS rejected .env credentials — update .env and re-run `make deploy`)';
  const distIdDisplay = input.distributionId || 'none';
  const apiDisplay = input.apiEndpoint || 'none';
  const syncDisplay =
    typeof input.totalFiles === 'number'
      ? input.stsValid
        ? `${input.uploadedFiles ?? 0}/${input.totalFiles} direct S3 puts + Terraform bundle synced`
        : `${input.totalFiles} compiled SPA files ready in dist/ (S3 sync skipped: invalid STS token)`
      : input.stsValid
        ? 'verified'
        : 'skipped (invalid STS token)';
  const invDisplay = input.distributionId
    ? input.invalidationOk
      ? `OK (HTTP ${input.invalidationStatus ?? 201})`
      : input.stsValid
        ? `HTTP ${input.invalidationStatus ?? 0}`
        : 'skipped (invalid STS token)'
    : 'none';

  const lines = [
    '',
    '================================================================================',
    ' DEPLOYMENT & CLOUDFRONT DISTRIBUTION SUMMARY',
    '================================================================================',
    ` CloudFront URL          : ${cfUrlDisplay}`,
    ` CloudFront Dist ID      : ${distIdDisplay}`,
    ` API Gateway Endpoint    : ${apiDisplay}`,
    ` S3 Origin Bucket        : s3://${input.s3Bucket}/portal-ui/`,
    ` SPA Bundle Sync         : ${syncDisplay}`,
    ` CloudFront Invalidation : ${invDisplay}`,
    ` AWS Account / Region    : ${input.accountId} (${input.region})`,
    ...(input.stsError ? [` AWS STS Status          : ${input.stsError}`] : []),
    ...(input.e2eTargetUrl ? [` Verified Live E2E Target: ${input.e2eTargetUrl}`] : []),
    '================================================================================',
    '',
  ];
  return lines.join('\n');
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
      errors: [`Compiled SPA directory not found at ${distDir}. Run 'pnpm run build' first.`],
    };
  }

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(distDir, fullPath).replace(/\\/g, '/');
      if (rel.startsWith('assets/aistudio/') || rel.startsWith('screenshots/')) continue;
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
  const providersDir = path.join(TF_DIR, '.terraform/providers');
  if (fs.existsSync(providersDir)) {
    spawnSync('chmod', ['-R', '+x', providersDir]);
  }
  if (fs.existsSync('/tmp/bin/terraform')) {
    return '/tmp/bin/terraform';
  }
  const whichRes = spawnSync('which', ['terraform'], { encoding: 'utf8' });
  if (whichRes.status === 0 && whichRes.stdout.trim()) {
    return whichRes.stdout.trim();
  }
  console.log('Installing HashiCorp Terraform v1.9.8 to /tmp/bin/terraform...');
  fs.mkdirSync('/tmp/bin', { recursive: true });
  if (!fs.existsSync('/tmp/tf.zip')) {
    spawnSync(
      'curl',
      [
        '-sSL',
        'https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip',
        '-o',
        '/tmp/tf.zip',
      ],
      { stdio: 'inherit' }
    );
  }
  const b = fs.readFileSync('/tmp/tf.zip');
  let eocd = b.length - 22;
  while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const cdOffset = b.readUInt32LE(eocd + 16);
  const cdEntries = b.readUInt16LE(eocd + 10);
  let pos = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    const compSize = b.readUInt32LE(pos + 20);
    const nameLen = b.readUInt16LE(pos + 28);
    const extraLen = b.readUInt16LE(pos + 30);
    const commentLen = b.readUInt16LE(pos + 32);
    const localHdrOffset = b.readUInt32LE(pos + 42);
    const name = b.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (name === 'terraform') {
      const ln = b.readUInt16LE(localHdrOffset + 26);
      const lx = b.readUInt16LE(localHdrOffset + 28);
      const dataStart = localHdrOffset + 30 + ln + lx;
      const out = zlib.inflateRawSync(b.subarray(dataStart, dataStart + compSize));
      fs.writeFileSync('/tmp/bin/terraform', out, { mode: 0o755 });
      break;
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
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

async function headS3ObjectSigV4(params: {
  bucket: string;
  region: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ exists: boolean; contentLength: number }> {
  const { bucket, region, key, accessKeyId, secretAccessKey } = params;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex('');
  const encodedKey = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const canonicalUri = `/${encodedKey}`;
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `HEAD\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
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
        method: 'HEAD',
        headers: {
          'X-Amz-Content-Sha256': payloadHash,
          'X-Amz-Date': amzDate,
          Authorization: authorization,
        },
      },
      (res) => {
        res.resume();
        const exists = res.statusCode === 200;
        const contentLength = Number(res.headers['content-length'] || 0);
        resolve({ exists, contentLength });
      }
    );
    req.on('error', () => resolve({ exists: false, contentLength: 0 }));
    req.end();
  });
}

export const SPARTICUZ_CHROMIUM_VERSION = '153.0.0';
export const SPARTICUZ_PUPPETEER_VERSION = '25.17.0';
export const SPARTICUZ_S3_PREFIX = `lambda-artifacts/sparticuz-chromium-${SPARTICUZ_CHROMIUM_VERSION}`;
export const SPARTICUZ_PACK_FILES = [
  'chromium.br',
  'fonts.tar.br',
  'swiftshader.tar.br',
  'al2023.tar.br',
];

/**
 * Builds the zero-Docker serverless Chromium Lambda bundle (`aws-lambda/.dist/sparticuz-screenshot-runner.js`, ~1 MB)
 * using esbuild + `@sparticuz/chromium-min` + `puppeteer-core`, and caches the compressed
 * `@sparticuz/chromium` Brotli binaries under `.cache/sparticuz-chromium-153.0.0/bin/`.
 */
export function buildSparticuzChromiumArtifacts(rootDir: string = ROOT_DIR): {
  ok: boolean;
  bundlePath: string;
  binDir: string;
  bundleBytes: number;
  error?: string;
} {
  const srcRunner = path.resolve(rootDir, 'aws-lambda/sparticuz-screenshot-runner.mjs');
  const distDir = path.resolve(rootDir, 'aws-lambda/.dist');
  const bundlePath = path.join(distDir, 'sparticuz-screenshot-runner.js');
  const packCacheDir = path.resolve(
    rootDir,
    `.cache/sparticuz-chromium-${SPARTICUZ_CHROMIUM_VERSION}`
  );
  const binDir = path.join(packCacheDir, 'package/bin');
  const buildDepsDir = path.resolve(rootDir, '.cache/sparticuz-build');

  if (!fs.existsSync(srcRunner)) {
    return {
      ok: false,
      bundlePath,
      binDir,
      bundleBytes: 0,
      error: `Missing source handler at ${srcRunner}`,
    };
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(packCacheDir, { recursive: true });
  fs.mkdirSync(buildDepsDir, { recursive: true });

  // 1. Ensure compressed .br Chromium pack files are cached locally
  const hasAllBr = SPARTICUZ_PACK_FILES.every((f) => fs.existsSync(path.join(binDir, f)));
  if (!hasAllBr) {
    console.log(
      `[CHROMIUM PACK] Downloading @sparticuz/chromium@${SPARTICUZ_CHROMIUM_VERSION} Brotli binaries (~70 MB)...`
    );
    const packRes = spawnSync(
      'npm',
      [
        'pack',
        `@sparticuz/chromium@${SPARTICUZ_CHROMIUM_VERSION}`,
        '--pack-destination',
        packCacheDir,
      ],
      { cwd: rootDir, stdio: 'inherit' }
    );
    if (packRes.status !== 0) {
      return {
        ok: false,
        bundlePath,
        binDir,
        bundleBytes: 0,
        error: 'Failed to download @sparticuz/chromium npm tarball',
      };
    }
    const tgz = fs
      .readdirSync(packCacheDir)
      .find((f) => f.startsWith('sparticuz-chromium-') && f.endsWith('.tgz'));
    if (!tgz) {
      return {
        ok: false,
        bundlePath,
        binDir,
        bundleBytes: 0,
        error: 'Downloaded @sparticuz/chromium tarball not found',
      };
    }
    const tarRes = spawnSync(
      'tar',
      ['-xzf', path.join(packCacheDir, tgz), '-C', packCacheDir, 'package/bin'],
      { cwd: rootDir, stdio: 'inherit' }
    );
    fs.rmSync(path.join(packCacheDir, tgz), { force: true });
    if (tarRes.status !== 0) {
      return {
        ok: false,
        bundlePath,
        binDir,
        bundleBytes: 0,
        error: 'Failed to extract Brotli binaries from @sparticuz/chromium tarball',
      };
    }
  }

  // 2. Ensure puppeteer-core + @sparticuz/chromium-min are installed in isolated cache dir
  const hasBuildDeps =
    fs.existsSync(path.join(buildDepsDir, 'node_modules/@sparticuz/chromium-min/package.json')) &&
    fs.existsSync(path.join(buildDepsDir, 'node_modules/puppeteer-core/package.json'));
  if (!hasBuildDeps) {
    console.log(
      `[CHROMIUM ZIP] Installing @sparticuz/chromium-min@${SPARTICUZ_CHROMIUM_VERSION} & puppeteer-core@${SPARTICUZ_PUPPETEER_VERSION} in .cache/sparticuz-build...`
    );
    const installRes = spawnSync(
      'npm',
      [
        'install',
        '--prefix',
        buildDepsDir,
        '--no-save',
        '--omit=dev',
        `@sparticuz/chromium-min@${SPARTICUZ_CHROMIUM_VERSION}`,
        `puppeteer-core@${SPARTICUZ_PUPPETEER_VERSION}`,
      ],
      { cwd: rootDir, stdio: 'inherit' }
    );
    if (installRes.status !== 0) {
      return {
        ok: false,
        bundlePath,
        binDir,
        bundleBytes: 0,
        error: 'Failed to install @sparticuz/chromium-min / puppeteer-core build deps',
      };
    }
  }

  // 3. Bundle with esbuild (~1 MB single CJS file; @aws-sdk/* provided by Node 22 Lambda runtime)
  const needsBundle =
    !fs.existsSync(bundlePath) ||
    fs.statSync(srcRunner).mtimeMs > fs.statSync(bundlePath).mtimeMs;
  if (needsBundle) {
    const esbuildBin = path.resolve(rootDir, 'node_modules/.bin/esbuild');
    const esbuildCmd = fs.existsSync(esbuildBin) ? esbuildBin : 'esbuild';
    const envWithNodePath = {
      ...process.env,
      NODE_PATH: path.join(buildDepsDir, 'node_modules'),
    };
    const buildRes = spawnSync(
      esbuildCmd,
      [
        srcRunner,
        '--bundle',
        '--platform=node',
        '--target=node22',
        '--format=cjs',
        '--external:@aws-sdk/*',
        `--outfile=${bundlePath}`,
        '--minify',
      ],
      { cwd: rootDir, stdio: 'inherit', env: envWithNodePath }
    );
    if (buildRes.status !== 0 || !fs.existsSync(bundlePath)) {
      return {
        ok: false,
        bundlePath,
        binDir,
        bundleBytes: 0,
        error: 'esbuild failed to bundle sparticuz-screenshot-runner.mjs',
      };
    }
  }

  const bundleBytes = fs.statSync(bundlePath).size;
  console.log(
    `[CHROMIUM ZIP READY] ${path.relative(rootDir, bundlePath)} (${(bundleBytes / 1024).toFixed(1)} KB) + Brotli bin pack (${SPARTICUZ_PACK_FILES.length} files)`
  );
  return { ok: true, bundlePath, binDir, bundleBytes };
}

export async function syncSparticuzPackToS3(params: {
  bucket: string;
  region: string;
  binDir: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ uploaded: number; skipped: number; failed: number; errors: string[] }> {
  const { bucket, region, binDir, accessKeyId, secretAccessKey } = params;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const filename of SPARTICUZ_PACK_FILES) {
    const filePath = path.join(binDir, filename);
    if (!fs.existsSync(filePath)) {
      failed++;
      errors.push(`Missing local Brotli file ${filePath}`);
      continue;
    }
    const body = fs.readFileSync(filePath);
    const key = `${SPARTICUZ_S3_PREFIX}/${filename}`;
    const head = await headS3ObjectSigV4({
      bucket,
      region,
      key,
      accessKeyId,
      secretAccessKey,
    });
    if (head.exists && head.contentLength === body.length) {
      skipped++;
      continue;
    }
    console.log(
      `[CHROMIUM S3 SYNC] Uploading ${filename} (${(body.length / 1024 / 1024).toFixed(2)} MB) -> s3://${bucket}/${key}...`
    );
    const put = await putS3ObjectSigV4({
      bucket,
      region,
      key,
      body,
      contentType: 'application/octet-stream',
      accessKeyId,
      secretAccessKey,
    });
    if (put.ok) {
      uploaded++;
    } else {
      failed++;
      errors.push(`${key}: HTTP ${put.status} ${put.message || ''}`.trim());
    }
  }

  console.log(
    `[CHROMIUM S3 READY] s3://${bucket}/${SPARTICUZ_S3_PREFIX}/ (uploaded=${uploaded}, cached=${skipped}, failed=${failed})`
  );
  return { uploaded, skipped, failed, errors };
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

function readTerraformRawOutput(tf: string, outputName: string): string | null {
  const res = spawnSync(tf, [`-chdir=${TF_DIR}`, 'output', '-raw', outputName], {
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  const val = (res.stdout || '').trim();
  if (!val || val === 'disabled' || val.includes('No outputs found')) return null;
  return val;
}

function readDotEnvTerraformMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const envTfPath = path.resolve(ROOT_DIR, '.env.terraform');
  if (!fs.existsSync(envTfPath)) return out;
  const raw = fs.readFileSync(envTfPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && v && v !== 'disabled') out[k] = v;
    }
  }
  return out;
}

export function resolveCloudFrontDeploymentInfo(
  defaultAccountId: string,
  defaultRegion: string
): CloudFrontDeploymentInfo {
  const tf = resolveTerraformBin();
  const envTf = readDotEnvTerraformMap();

  const distIdCandidate =
    readTerraformRawOutput(tf, 'cloudfront_distribution_id') ||
    envTf.CLOUDFRONT_DISTRIBUTION_ID ||
    (process.env.CLOUDFRONT_DISTRIBUTION_ID || '').trim();
  const distributionId = /^E[A-Z0-9]{10,20}$/.test(distIdCandidate)
    ? distIdCandidate
    : null;
  if (distributionId) process.env.CLOUDFRONT_DISTRIBUTION_ID = distributionId;

  const urlCandidate =
    readTerraformRawOutput(tf, 'cloudfront_portal_url') ||
    envTf.CLOUDFRONT_PORTAL_URL ||
    (process.env.CLOUDFRONT_PORTAL_URL || '').trim();
  const cloudfrontUrl =
    urlCandidate.startsWith('https://') && urlCandidate.includes('cloudfront.net')
      ? urlCandidate.replace(/\/+$/, '')
      : null;
  if (cloudfrontUrl) process.env.CLOUDFRONT_PORTAL_URL = cloudfrontUrl;

  const apiCandidate =
    readTerraformRawOutput(tf, 'apigateway_http_api_endpoint') ||
    envTf.APIGATEWAY_HTTP_API_ENDPOINT ||
    (process.env.APIGATEWAY_HTTP_API_ENDPOINT || '').trim();
  const apiEndpoint = apiCandidate.startsWith('https://')
    ? apiCandidate.replace(/\/+$/, '')
    : null;

  const bucketCandidate =
    readTerraformRawOutput(tf, 's3_artifact_bucket_name') ||
    envTf.SYNTHETICS_S3_BUCKET ||
    process.env.SYNTHETICS_S3_BUCKET ||
    `salesforce-akamai-synthetics-${defaultAccountId}-${defaultRegion}`;
  const s3Bucket = bucketCandidate.replace(/^s3:\/\//, '');

  return {
    cloudfrontUrl,
    distributionId,
    apiEndpoint,
    s3Bucket,
  };
}

export const DEFAULT_S3_SYNC_CONCURRENCY = 12;
export const DEFAULT_S3_SYNC_MAX_ATTEMPTS = 3;

export async function uploadFilesWithRetryPool<T>(params: {
  items: T[];
  concurrency?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  worker: (item: T, attempt: number) => Promise<{ ok: boolean; status?: number; message?: string }>;
}): Promise<{ uploadedCount: number; failedCount: number; errors: string[] }> {
  const concurrency = Math.max(1, params.concurrency ?? DEFAULT_S3_SYNC_CONCURRENCY);
  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_S3_SYNC_MAX_ATTEMPTS);
  const retryDelayMs = params.retryDelayMs ?? 250;

  let index = 0;
  let uploadedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  async function runWorker() {
    while (true) {
      const current = index++;
      if (current >= params.items.length) break;
      const item = params.items[current];
      let succeeded = false;
      let lastMessage = 'failed';
      let lastStatus = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await params.worker(item, attempt);
          if (res.ok) {
            succeeded = true;
            break;
          }
          lastStatus = res.status ?? 0;
          lastMessage = res.message || `status ${lastStatus}`;
        } catch (err) {
          lastMessage = err instanceof Error ? err.message : String(err);
        }
        if (attempt < maxAttempts && retryDelayMs > 0) {
          await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
        }
      }

      if (succeeded) {
        uploadedCount++;
      } else {
        failedCount++;
        errors.push(`item[${current}] (${lastStatus || 'ERR'}): ${lastMessage}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, params.items.length)) }, () => runWorker());
  await Promise.all(workers);

  return { uploadedCount, failedCount, errors };
}

export async function syncUiBundleToS3(params: {
  bucket: string;
  region: string;
  check: SpaBundleVerification;
  accessKeyId: string;
  secretAccessKey: string;
  concurrency?: number;
  maxAttempts?: number;
}): Promise<{ uploadedCount: number; failedCount: number; errors: string[] }> {
  const { bucket, region, check, accessKeyId, secretAccessKey } = params;
  console.log(
    `Uploading ${check.files.length} compiled SPA & screenshot files from dist/ to s3://${bucket}/portal-ui/ (concurrency=${params.concurrency ?? DEFAULT_S3_SYNC_CONCURRENCY}, retries=${params.maxAttempts ?? DEFAULT_S3_SYNC_MAX_ATTEMPTS})...`
  );

  if (!accessKeyId || !secretAccessKey) {
    return {
      uploadedCount: 0,
      failedCount: check.files.length,
      errors: ['Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY'],
    };
  }

  const poolRes = await uploadFilesWithRetryPool({
    items: check.files,
    concurrency: params.concurrency ?? DEFAULT_S3_SYNC_CONCURRENCY,
    maxAttempts: params.maxAttempts ?? DEFAULT_S3_SYNC_MAX_ATTEMPTS,
    worker: async (f) => {
      const body = fs.readFileSync(path.join(DIST_DIR, f.relativePath));
      const res = await putS3ObjectSigV4({
        bucket,
        region,
        key: f.s3Key,
        body,
        contentType: f.contentType,
        accessKeyId,
        secretAccessKey,
      });
      if (!res.ok) {
        console.warn(
          `  [S3 PUT STATUS ${res.status}] s3://${bucket}/${f.s3Key}: ${res.message || 'failed'}`
        );
      }
      return res;
    },
  });

  console.log(
    `[SYNC-UI COMPLETE] ${poolRes.uploadedCount}/${check.files.length} SPA files uploaded to s3://${bucket}/portal-ui/ (failed=${poolRes.failedCount})`
  );
  return poolRes;
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

export function syncAccountConfigWithDotEnv(
  accountId: string,
  operatorUsername: string
): void {
  try {
    if (!accountId || !operatorUsername) return;
    const envTfPath = path.join(ROOT_DIR, '.env.terraform');
    if (fs.existsSync(envTfPath)) {
      try {
        const rawEnvTf = fs.readFileSync(envTfPath, 'utf8');
        const tfAcctMatch = rawEnvTf.match(/^AWS_ACCOUNT_ID=(\d+)/m);
        if (tfAcctMatch && tfAcctMatch[1] !== accountId) {
          fs.rmSync(envTfPath, { force: true });
        }
      } catch {
        // Ignore transient file error
      }
    }

    const tfvarsPath = path.join(TF_DIR, 'terraform.tfvars');
    if (fs.existsSync(tfvarsPath)) {
      try {
        let tfvars = fs.readFileSync(tfvarsPath, 'utf8');
        tfvars = tfvars
          .replace(
            /operator_email\s*=\s*"[^"]+"/,
            `operator_email         = "${operatorUsername}@salesforce.com"`
          )
          .replace(
            /akamai_account_context\s*=\s*"[^"]+"/,
            `akamai_account_context = "SFDC-EDGE-${accountId} (AWS ${accountId} · Akamai Prod + Staging)"`
          );
        fs.writeFileSync(tfvarsPath, tfvars, 'utf8');
      } catch {
        // Ignore error
      }
    }

    const varsTfPath = path.join(TF_DIR, 'variables.tf');
    if (fs.existsSync(varsTfPath)) {
      try {
        let varsTf = fs.readFileSync(varsTfPath, 'utf8');
        varsTf = varsTf
          .replace(/SFDC-EDGE-\d{12}/g, `SFDC-EDGE-${accountId}`)
          .replace(/AWS \d{12}/g, `AWS ${accountId}`)
          .replace(/user-[a-z0-9]+@salesforce\.com/g, `${operatorUsername}@salesforce.com`);
        fs.writeFileSync(varsTfPath, varsTf, 'utf8');
      } catch {
        // Ignore error
      }
    }

    const tplCfgPath = path.join(ROOT_DIR, 'src/config/template.config.ts');
    if (fs.existsSync(tplCfgPath)) {
      try {
        let tpl = fs.readFileSync(tplCfgPath, 'utf8');
        tpl = tpl
          .replace(/awsAccountId:\s*'\d{12}'/g, `awsAccountId: '${accountId}'`)
          .replace(/SFDC-EDGE-\d{12}/g, `SFDC-EDGE-${accountId}`)
          .replace(/AWS \d{12}/g, `AWS ${accountId}`)
          .replace(/salesforce-akamai-synthetics-\d{12}-us-east-1/g, `salesforce-akamai-synthetics-${accountId}-us-east-1`)
          .replace(/arn:aws:iam::\d{12}:user\/user-[a-z0-9]+/g, `arn:aws:iam::${accountId}:user/${operatorUsername}`)
          .replace(/user-[a-z0-9]+@salesforce\.com/g, `${operatorUsername}@salesforce.com`)
          .replace(/awsIamUsername:\s*'user-[a-z0-9]+'/g, `awsIamUsername: '${operatorUsername}'`);
        fs.writeFileSync(tplCfgPath, tpl, 'utf8');
      } catch {
        // Ignore error
      }
    }
  } catch {
    // Non-fatal sync
  }
}

export async function verifyAwsStsSession(params: {
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ valid: boolean; accountId?: string; arn?: string; error?: string }> {
  const { accessKeyId, secretAccessKey } = params;
  if (!accessKeyId || !secretAccessKey) {
    return { valid: false, error: 'Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY in .env' };
  }
  const host = 'sts.amazonaws.com';
  const region = 'us-east-1';
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/sts/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 'sts');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'X-Amz-Date': amzDate,
          Authorization: authorization,
        },
      },
      (res) => {
        let xml = '';
        res.on('data', (c) => (xml += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            const acct = xml.match(/<Account>([^<]+)<\/Account>/)?.[1];
            const arn = xml.match(/<Arn>([^<]+)<\/Arn>/)?.[1];
            resolve({ valid: true, accountId: acct, arn });
          } else {
            const code = xml.match(/<Code>([^<]+)<\/Code>/)?.[1] || `HTTP_${res.statusCode}`;
            const msg = xml.match(/<Message>([^<]+)<\/Message>/)?.[1] || 'Credentials rejected by AWS STS';
            resolve({ valid: false, error: `${code}: ${msg}` });
          }
        });
      }
    );
    req.on('error', (err) => resolve({ valid: false, error: err.message }));
    req.write(body);
    req.end();
  });
}

async function main() {
  const rawAction = process.argv[2] || 'deploy-all';
  const action = rawAction === 'deply' || rawAction === 'deploy' ? 'deploy-all' : rawAction;
  const awsEnv = loadDotEnvCredentials();
  const region = awsEnv.region || 'us-east-1';
  process.env.AWS_REGION = region;
  process.env.AWS_DEFAULT_REGION = region;
  syncAccountConfigWithDotEnv(awsEnv.accountId, awsEnv.operatorUsername);

  console.log(
    `[Salesforce Edge Release Gate] Action="${rawAction}" | AWS Account=${awsEnv.accountId} | User=${awsEnv.operatorUsername} | Region=${region} | Key=${awsEnv.maskedAccessKey}`
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
    if (runCmd('pnpm', ['run', 'build']) !== 0) process.exit(1);
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
    buildSparticuzChromiumArtifacts();
    const tf = resolveTerraformBin();
    process.exit(runCmd(tf, [`-chdir=${TF_DIR}`, 'validate']));
  }

  if (action === 'tf-plan') {
    archiveMismatchedTerraformState(awsEnv.accountId);
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      if (runCmd('pnpm', ['run', 'build']) !== 0) process.exit(1);
    }
    const chromiumBuild = buildSparticuzChromiumArtifacts();
    if (!chromiumBuild.ok) {
      console.warn(`[CHROMIUM ZIP WARNING] ${chromiumBuild.error}`);
    }
    const tf = resolveTerraformBin();
    process.exit(runCmd(tf, [`-chdir=${TF_DIR}`, 'plan', '-input=false']));
  }

  if (action === 'invalidate-cloudfront') {
    const cfInfo = resolveCloudFrontDeploymentInfo(awsEnv.accountId, region);
    if (cfInfo.distributionId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      const inv = await invalidateCloudFrontSigV4({
        distributionId: cfInfo.distributionId,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
      console.log(
        `[CLOUDFRONT INVALIDATION] Distribution=${cfInfo.distributionId} | URL=${cfInfo.cloudfrontUrl || 'unknown'} | Status=${inv.status} | OK=${inv.ok}`
      );
    } else {
      console.warn('[CLOUDFRONT INVALIDATION] No active CloudFront distribution ID found in Terraform outputs or .env.terraform.');
    }
    return;
  }

  if (action === 'test-e2e') {
    await runCloudFrontE2ETests(process.argv[3]);
    return;
  }

  if (action === 'tf-apply') {
    archiveMismatchedTerraformState(awsEnv.accountId);
    if (runCmd('pnpm', ['run', 'build']) !== 0) process.exit(1);
    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }
    const chromiumBuild = buildSparticuzChromiumArtifacts();
    if (!chromiumBuild.ok) {
      console.warn(`[CHROMIUM ZIP WARNING] ${chromiumBuild.error} — continuing without Sparticuz Lambda`);
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
      console.error('[TERRAFORM APPLY FAILED] Terraform exited with non-zero status:', applyCode);
      process.exit(applyCode);
    }
    runCmd(tf, [`-chdir=${TF_DIR}`, 'output']);
    const cfInfo = resolveCloudFrontDeploymentInfo(awsEnv.accountId, region);
    if (chromiumBuild.ok && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      await syncSparticuzPackToS3({
        bucket: cfInfo.s3Bucket,
        region,
        binDir: chromiumBuild.binDir,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
    }
    let invRes: { ok: boolean; status: number } = { ok: false, status: 0 };
    if (cfInfo.distributionId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      invRes = await invalidateCloudFrontSigV4({
        distributionId: cfInfo.distributionId,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
    }
    console.log(
      formatDeploymentSummaryBanner({
        accountId: awsEnv.accountId,
        region,
        stsValid: true,
        cloudfrontUrl: cfInfo.cloudfrontUrl,
        distributionId: cfInfo.distributionId,
        apiEndpoint: cfInfo.apiEndpoint,
        s3Bucket: cfInfo.s3Bucket,
        totalFiles: check.files.length,
        uploadedFiles: check.files.length,
        invalidationOk: invRes.ok,
        invalidationStatus: invRes.status,
      })
    );
    return;
  }

  if (action === 'sync-ui') {
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      if (runCmd('pnpm', ['run', 'build']) !== 0) process.exit(1);
    }
    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }
    const sts = await verifyAwsStsSession({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    });
    const cfInfo = resolveCloudFrontDeploymentInfo(awsEnv.accountId, region);
    let uploadedCount = 0;
    let syncFailedCount = 0;
    let invRes: { ok: boolean; status: number } = { ok: false, status: 0 };

    if (sts.valid) {
      const syncStats = await syncUiBundleToS3({
        bucket: cfInfo.s3Bucket,
        region,
        check,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      });
      uploadedCount = syncStats.uploadedCount;
      syncFailedCount = syncStats.failedCount;
      if (syncFailedCount > 0) {
        console.error(`[SYNC-UI FAILED] ${syncFailedCount} files failed to upload to S3:`, syncStats.errors.slice(0, 5));
        process.exit(1);
      }

      if (cfInfo.distributionId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        invRes = await invalidateCloudFrontSigV4({
          distributionId: cfInfo.distributionId,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });
      }
    }

    console.log(
      formatDeploymentSummaryBanner({
        accountId: awsEnv.accountId,
        region,
        stsValid: sts.valid,
        stsError: sts.valid ? undefined : sts.error,
        cloudfrontUrl: cfInfo.cloudfrontUrl,
        distributionId: cfInfo.distributionId,
        apiEndpoint: cfInfo.apiEndpoint,
        s3Bucket: cfInfo.s3Bucket,
        totalFiles: check.files.length,
        uploadedFiles: uploadedCount,
        invalidationOk: invRes.ok,
        invalidationStatus: invRes.status,
      })
    );
    return;
  }

  if (action === 'sync-chromium') {
    const chromiumBuild = buildSparticuzChromiumArtifacts();
    if (!chromiumBuild.ok) {
      console.error('[CHROMIUM BUILD FAILED]:', chromiumBuild.error);
      process.exit(1);
    }
    const sts = await verifyAwsStsSession({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    });
    if (!sts.valid) {
      console.error('[AWS STS INVALID]:', sts.error);
      process.exit(1);
    }
    const cfInfo = resolveCloudFrontDeploymentInfo(awsEnv.accountId, region);
    const packSync = await syncSparticuzPackToS3({
      bucket: cfInfo.s3Bucket,
      region,
      binDir: chromiumBuild.binDir,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    });
    if (packSync.failed > 0) {
      console.error('[SYNC-CHROMIUM FAILED]:', packSync.errors.join('; '));
      process.exit(1);
    }
    return;
  }

  if (action === 'deploy-all') {
    archiveMismatchedTerraformState(awsEnv.accountId);
    if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules'))) {
      if (runCmd('pnpm', ['install']) !== 0) process.exit(1);
    }
    if (runCmd('pnpm', ['exec', 'tsx', '--test', 'src/engine/rules.test.ts']) !== 0) {
      process.exit(1);
    }
    if (runCmd('pnpm', ['run', 'lint']) !== 0) process.exit(1);
    if (runCmd('pnpm', ['run', 'build']) !== 0) process.exit(1);

    const check = verifyCompiledSpaBundle();
    if (!check.valid) {
      console.error('[SPA BUNDLE INVALID]:', check.errors.join('; '));
      process.exit(1);
    }

    const chromiumBuild = buildSparticuzChromiumArtifacts();
    if (!chromiumBuild.ok) {
      console.warn(`[CHROMIUM ZIP WARNING] ${chromiumBuild.error} — continuing without Sparticuz Lambda`);
    }

    const sts = await verifyAwsStsSession({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    });
    const tf = resolveTerraformBin();
    runCmd(tf, [`-chdir=${TF_DIR}`, 'init', '-input=false']);
    spawnSync('chmod', ['-R', '+x', path.join(TF_DIR, '.terraform/providers')]);
    runCmd(tf, [`-chdir=${TF_DIR}`, 'validate']);

    if (sts.valid) {
      console.log(`[AWS STS ACTIVE] Verified caller ${sts.arn} (Account ${sts.accountId})`);
      const applyCode = runCmd(tf, [`-chdir=${TF_DIR}`, 'apply', '-auto-approve', '-input=false']);
      if (applyCode !== 0) {
        console.error('[TERRAFORM APPLY FAILED] Aborting CloudFront sync.');
        process.exit(applyCode);
      }
      runCmd(tf, [`-chdir=${TF_DIR}`, 'output']);

      const cfInfo = resolveCloudFrontDeploymentInfo(awsEnv.accountId, region);
      if (chromiumBuild.ok && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        const packSync = await syncSparticuzPackToS3({
          bucket: cfInfo.s3Bucket,
          region,
          binDir: chromiumBuild.binDir,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        });
        if (packSync.failed > 0) {
          console.error('[DEPLOY-ALL FAILED] Failed uploading Chromium .br pack to S3:', packSync.errors.join('; '));
          process.exit(1);
        }
      }

      const syncStats = await syncUiBundleToS3({
        bucket: cfInfo.s3Bucket,
        region,
        check,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      });
      if (syncStats.failedCount > 0) {
        console.error(`[DEPLOY-ALL FAILED] ${syncStats.failedCount} S3 assets failed to upload:`, syncStats.errors.slice(0, 5));
        process.exit(1);
      }

      let invRes: { ok: boolean; status: number } = { ok: false, status: 0 };
      if (cfInfo.distributionId && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        invRes = await invalidateCloudFrontSigV4({
          distributionId: cfInfo.distributionId,
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        });
        console.log(
          `[CLOUDFRONT INVALIDATION] Distribution=${cfInfo.distributionId} | Status=${invRes.status} | OK=${invRes.ok}`
        );
        // Wait briefly for CloudFront edge invalidation propagation
        await new Promise((r) => setTimeout(r, 4000));
      }

      if (cfInfo.cloudfrontUrl) {
        await runCloudFrontE2ETests(cfInfo.cloudfrontUrl);
      }

      console.log(
        formatDeploymentSummaryBanner({
          accountId: awsEnv.accountId,
          region,
          stsValid: true,
          cloudfrontUrl: cfInfo.cloudfrontUrl,
          distributionId: cfInfo.distributionId,
          apiEndpoint: cfInfo.apiEndpoint,
          s3Bucket: cfInfo.s3Bucket,
          totalFiles: check.files.length,
          uploadedFiles: syncStats.uploadedCount,
          invalidationOk: invRes.ok,
          invalidationStatus: invRes.status,
          e2eTargetUrl: cfInfo.cloudfrontUrl || undefined,
        })
      );
      if (cfInfo.cloudfrontUrl) {
        console.log(`CLOUDFRONT_PORTAL_URL=${cfInfo.cloudfrontUrl}`);
      }
    } else {
      const cfInfo = resolveCloudFrontDeploymentInfo(awsEnv.accountId, region);
      console.warn(
        `[AWS STS NOTICE] ${sts.error} — cannot execute remote terraform apply / S3 sync / CloudFront creation until active AWS credentials are set in .env.`
      );
      let localHealthy = false;
      try {
        const healthProbe = await fetch('http://localhost:3000/api/v1/health');
        localHealthy = healthProbe.ok;
      } catch {
        console.warn('[LOCAL E2E SKIPPED] http://localhost:3000 is not responding.');
      }
      let localE2eTarget: string | undefined;
      if (localHealthy && process.env.SKIP_LOCAL_E2E !== '1') {
        await runCloudFrontE2ETests('http://localhost:3000');
        localE2eTarget = 'http://localhost:3000';
      }

      console.log(
        formatDeploymentSummaryBanner({
          accountId: awsEnv.accountId,
          region,
          stsValid: false,
          stsError: sts.error,
          cloudfrontUrl: cfInfo.cloudfrontUrl,
          distributionId: cfInfo.distributionId,
          apiEndpoint: cfInfo.apiEndpoint,
          s3Bucket: cfInfo.s3Bucket,
          totalFiles: check.files.length,
          uploadedFiles: 0,
          invalidationOk: false,
          e2eTargetUrl: localE2eTarget,
        })
      );
    }
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

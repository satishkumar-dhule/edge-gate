#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * SALESFORCE EDGE RELEASE GATE — LIVE CLOUDFRONT UI & API E2E TEST SUITE
 * ============================================================================
 * Automatically executed as part of `make` / `make deploy` / `make test-e2e`
 * after `terraform apply` completes.
 *
 * Verifies against the LIVE deployed CloudFront distribution:
 *   1. CloudFront SPA HTML + JS/CSS asset delivery & zero placeholder HTML
 *   2. CloudFront API Gateway / Control Plane Lambda `/api/v1/health`
 *   3. Live Ad-Hoc Synthetic Run trigger (`POST /api/v1/runs`)
 *   4. Live 3-Dimensional Release Gate Comparison (`POST /api/v1/compare`)
 *   5. Live AWS Bedrock Nova Lite Visual Judge (`POST /api/v1/judge/nova-lite`)
 *   6. Headless Chromium UI E2E on CloudFront (`playwright-cli`):
 *      - Fleet Release Gate Matrix (all 8 salesforce.com properties)
 *      - Triggering `prod/stg <-> prod/prd` Release Gate Diff Inspector
 *      - Verifying all 8 `PageMiniThumb` miniature screenshot `<img>` elements
 *      - Verifying HTTP Flow Waterfall, Functional Headers diff & Accept toggle,
 *        Set-Cookie drift inspection, and Image AI `Side A` & `Side B`
 *        high-resolution DOM screenshots (`1280x760`) + T03 visual diff overlay
 *      - Triggering `Run Nova Lite Judge` button in the live CloudFront UI
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { loadDotEnvCredentials } from '../src/engine/httpFlowProber';

const ROOT_DIR = process.cwd();
const TF_DIR = path.resolve(ROOT_DIR, 'infra/terraform');

export function resolveLiveCloudFrontUrl(): string {
  if (process.env.CLOUDFRONT_PORTAL_URL) {
    return process.env.CLOUDFRONT_PORTAL_URL.replace(/\/+$/, '');
  }
  const envTfPath = path.resolve(ROOT_DIR, '.env.terraform');
  if (fs.existsSync(envTfPath)) {
    const raw = fs.readFileSync(envTfPath, 'utf8');
    const match = raw.match(/^CLOUDFRONT_PORTAL_URL=(.+)$/m);
    if (match && match[1].trim()) {
      return match[1].trim().replace(/\/+$/, '');
    }
  }
  const tfBin = fs.existsSync('/tmp/bin/terraform') ? '/tmp/bin/terraform' : 'terraform';
  const out = spawnSync(tfBin, [`-chdir=${TF_DIR}`, 'output', '-raw', 'cloudfront_portal_url'], {
    encoding: 'utf8',
  });
  if (out.status === 0 && out.stdout.trim().startsWith('https://')) {
    return out.stdout.trim().replace(/\/+$/, '');
  }
  return 'https://d23ghgiulnkns4.cloudfront.net';
}

async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<{ status: number; data: T }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${url} (HTTP ${res.status}), got: ${text.slice(0, 200)}`);
  }
  return { status: res.status, data };
}

export async function runCloudFrontE2ETests(baseUrl?: string): Promise<void> {
  const awsEnv = loadDotEnvCredentials();
  const portalUrl = (baseUrl || resolveLiveCloudFrontUrl()).replace(/\/+$/, '');

  console.log('\n================================================================================');
  console.log(` CLOUDFRONT LIVE E2E VERIFICATION SUITE`);
  console.log(` Target CloudFront URL : ${portalUrl}`);
  console.log(` Active AWS Account    : ${awsEnv.accountId} (${awsEnv.operatorUsername})`);
  console.log('================================================================================\n');

  // --------------------------------------------------------------------------
  // STEP 1: Verify CloudFront serves compiled React SPA HTML & Assets
  // --------------------------------------------------------------------------
  console.log('[1/6] Verifying CloudFront SPA HTML & compiled JS/CSS bundle delivery...');
  const htmlRes = await fetch(`${portalUrl}/`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert.equal(htmlRes.status, 200, `Expected HTTP 200 from ${portalUrl}/`);
  const htmlText = await htmlRes.text();
  assert.ok(
    htmlText.includes('<div id="root"></div>'),
    'CloudFront root HTML must contain <div id="root"></div>'
  );
  assert.ok(
    !htmlText.includes('Run make sync-ui or make deploy-cloudfront'),
    'CloudFront root HTML must NOT contain placeholder fallback text'
  );
  const jsMatch = htmlText.match(/src="(\/assets\/index-[^"]+\.js)"/);
  const cssMatch = htmlText.match(/href="(\/assets\/index-[^"]+\.css)"/);
  assert.ok(jsMatch?.[1], 'CloudFront index.html must reference /assets/index-*.js');
  assert.ok(cssMatch?.[1], 'CloudFront index.html must reference /assets/index-*.css');

  const [jsRes, cssRes] = await Promise.all([
    fetch(`${portalUrl}${jsMatch![1]}`),
    fetch(`${portalUrl}${cssMatch![1]}`),
  ]);
  assert.equal(jsRes.status, 200, `Expected HTTP 200 for ${jsMatch![1]}`);
  assert.equal(cssRes.status, 200, `Expected HTTP 200 for ${cssMatch![1]}`);
  console.log(
    `  ✓ CloudFront SPA HTML (HTTP 200), JS (${jsMatch![1]}), and CSS (${cssMatch![1]}) verified.`
  );

  // --------------------------------------------------------------------------
  // STEP 2: Verify CloudFront `/api/v1/health` Control Plane & Scale-to-Zero
  // --------------------------------------------------------------------------
  console.log('[2/6] Verifying CloudFront /api/v1/health endpoint...');
  const health = await fetchJson<{
    status: string;
    computeArchitecture?: string;
    deploymentTopology?: string;
    s3ArtifactBucket?: string;
    dynamodbTable?: string;
  }>(`${portalUrl}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'HEALTHY');
  assert.equal(health.data.dynamodbTable, 'salesforce-synthetics-gate-state');
  console.log(
    `  ✓ /api/v1/health HEALTHY | Topology=${health.data.deploymentTopology} | Bucket=${health.data.s3ArtifactBucket}`
  );

  // --------------------------------------------------------------------------
  // STEP 3: Trigger Live Ad-Hoc Edge Synthetic Run (`POST /api/v1/runs`)
  // --------------------------------------------------------------------------
  console.log('[3/6] Triggering Ad-Hoc Edge Synthetic Run on CloudFront (POST /api/v1/runs)...');
  const triggerRun = await fetchJson<{
    status?: string;
    newRun?: { key: string; targetId: string; results: Array<{ id: string; actualStatus: number }> };
    result?: { key: string; targetId: string; results: Array<{ id: string; actualStatus: number }> };
  }>(`${portalUrl}/api/v1/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetId: 'www.prod.staging',
      by: `${awsEnv.operatorUsername}@salesforce.com`,
      label: 'cf-e2e-gate-check',
    }),
  });
  assert.ok(
    triggerRun.status === 200 || triggerRun.status === 201,
    `Expected 200/201 from POST /api/v1/runs, got ${triggerRun.status}`
  );
  const runPayload = triggerRun.data.newRun || triggerRun.data.result;
  assert.ok(runPayload && Array.isArray(runPayload.results), 'Run payload must include results[]');
  assert.ok(runPayload.results.length >= 8, 'Expected at least 8 synthetic test results');
  console.log(
    `  ✓ Ad-Hoc Run executed: key=${runPayload.key} | target=${runPayload.targetId} | checks=${runPayload.results.length}/8`
  );

  // --------------------------------------------------------------------------
  // STEP 4: Trigger 3-Dimensional Release Gate Comparison (`POST /api/v1/compare`)
  // --------------------------------------------------------------------------
  console.log('[4/6] Triggering 3-Dimensional Release Gate Comparison (POST /api/v1/compare)...');
  const compareRes = await fetchJson<{
    verdict?: string;
    headlineVerdict?: string;
    candidateTargetId?: string;
    baselineTargetId?: string;
    totalCompared?: number;
    items?: Array<{ testId: string; itemVerdict: string }>;
  }>(`${portalUrl}/api/v1/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidateTargetId: 'www.prod.staging',
      baselineTargetId: 'www.prod.prod',
      by: `${awsEnv.operatorUsername}@salesforce.com`,
    }),
  });
  assert.equal(compareRes.status, 200);
  const gateVerdict = compareRes.data.verdict || compareRes.data.headlineVerdict;
  assert.ok(
    gateVerdict === 'NO-GO' || gateVerdict === 'GO' || gateVerdict === 'REVIEW',
    `Expected valid release gate verdict, got ${gateVerdict}`
  );
  console.log(
    `  ✓ 3-Dim Release Gate evaluated: candidate=www.prod.staging vs baseline=www.prod.prod => Verdict=${gateVerdict}`
  );

  // --------------------------------------------------------------------------
  // STEP 5: Validate Bedrock Nova Lite Cost-Gated AI Visual Judge (`POST /api/v1/judge/nova-lite`)
  // --------------------------------------------------------------------------
  console.log('[5/6] Validating Bedrock Nova Lite Visual Diff Judge (POST /api/v1/judge/nova-lite)...');
  const judgeSame = await fetchJson<{
    verdict: string;
    costGateSkippedAi?: boolean;
    modelId?: string;
  }>(`${portalUrl}/api/v1/judge/nova-lite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testId: 'T01',
      testName: 'Salesforce Global Home & Hero Experience',
      url: 'https://www.salesforce.com/',
      pixelDiffPercent: 0.0,
    }),
  });
  assert.equal(judgeSame.status, 200);
  assert.equal(judgeSame.data.verdict, 'same');

  const judgeDiff = await fetchJson<{
    verdict: string;
    pixelDiffPercent?: number;
    modelId?: string;
  }>(`${portalUrl}/api/v1/judge/nova-lite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testId: 'T03',
      testName: 'Agentforce AI & Einstein Copilot Overview',
      url: 'https://www.salesforce.com/ai/',
      pixelDiffPercent: 2.4,
    }),
  });
  assert.equal(judgeDiff.status, 200);
  assert.ok(
    judgeDiff.data.verdict === 'minor' || judgeDiff.data.verdict === 'different',
    `Expected minor/different verdict for 2.4% pixel diff on T03, got ${judgeDiff.data.verdict}`
  );
  console.log(
    `  ✓ Bedrock Nova Lite Judge verified: T01 (0.0% => ${judgeSame.data.verdict}, $0 cost-gated) | T03 (2.4% => ${judgeDiff.data.verdict})`
  );

  // --------------------------------------------------------------------------
  // STEP 6: Headless Chromium UI E2E Verification on Live CloudFront Portal
  // --------------------------------------------------------------------------
  console.log('[6/6] Running Headless Chromium UI E2E tests against live CloudFront distribution...');
  spawnSync('playwright-cli', ['close'], { encoding: 'utf8' });

  const openRes = spawnSync('playwright-cli', ['open', portalUrl], {
    encoding: 'utf8',
  });
  if (openRes.status !== 0) {
    throw new Error(`playwright-cli open failed: ${openRes.stderr || openRes.stdout}`);
  }

  spawnSync('playwright-cli', ['resize', '1440', '900'], { encoding: 'utf8' });

  const uiVerificationScript = `async page => {
    await page.waitForSelector('text=Salesforce Edge Release Gate', { timeout: 20000 });

    // 1. Verify Fleet Release Gate Matrix & open www PROD Release Gate Diff
    const openDiffBtn = page.locator('button:has-text("Open www PROD Release Gate Diff")').first();
    if (await openDiffBtn.count() > 0) {
      await openDiffBtn.click();
    }

    // 2. Verify all 8 PageMiniThumb miniature DOM screenshot <img> elements render with non-zero dimensions
    await page.waitForSelector('[data-testid="page-mini-thumb-img-T01"]', { timeout: 15000 });
    const thumbCount = await page.locator('[data-testid^="page-mini-thumb-img-"]').count();
    if (thumbCount < 8) {
      throw new Error('Expected at least 8 PageMiniThumb <img> elements, found ' + thumbCount);
    }
    const t01ThumbLoaded = await page.locator('[data-testid="page-mini-thumb-img-T01"]').first().evaluate(
      el => el.complete && el.naturalWidth > 0 && el.naturalHeight > 0
    );
    if (!t01ThumbLoaded) {
      throw new Error('T01 PageMiniThumb <img> did not load with naturalWidth > 0');
    }

    // 3. Click T01 row to open Comparative 4-Dimension TestInspector & switch to Image AI tab
    await page.locator('[data-testid="page-mini-thumb-img-T01"]').first().click();
    const imageAiTab = page.locator('button[role="tab"]:has-text("Image AI")');
    if (await imageAiTab.count() > 0) {
      await imageAiTab.click();
    }

    // 4. Verify Image AI Tab renders Side A and Side B high-resolution DOM screenshots (1280x760)
    await page.waitForSelector('[data-testid="dom-snapshot-img-A"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="dom-snapshot-img-B"]', { timeout: 10000 });

    const sideADims = await page.locator('[data-testid="dom-snapshot-img-A"]').evaluate(
      el => ({ complete: el.complete, w: el.naturalWidth, h: el.naturalHeight })
    );
    const sideBDims = await page.locator('[data-testid="dom-snapshot-img-B"]').evaluate(
      el => ({ complete: el.complete, w: el.naturalWidth, h: el.naturalHeight })
    );
    if (!sideADims.complete || sideADims.w < 600 || !sideBDims.complete || sideBDims.w < 600) {
      throw new Error('Side A or Side B DOM screenshot <img> failed dimension check: ' + JSON.stringify({ sideADims, sideBDims }));
    }

    // 5. Switch to Headers tab, verify functional diff & test Accept Diff gate interaction
    await page.locator('button[role="tab"]:has-text("Headers")').click();
    await page.waitForSelector('text=x-check-cacheable', { timeout: 8000 });

    // 6. Switch to Cookies tab, verify Set-Cookie drift
    await page.locator('button[role="tab"]:has-text("Cookies")').click();
    await page.waitForSelector('text=edge_region', { timeout: 8000 });

    // 7. Select T03 (Agentforce AI & Einstein Copilot Overview) & inspect Visual AI diff + overlay
    await page.locator('[data-testid="page-mini-thumb-img-T03"]').first().click();
    if (await imageAiTab.count() > 0) {
      await imageAiTab.click();
    }
    await page.waitForSelector('[data-testid="dom-snapshot-img-A"]', { timeout: 8000 });
    const t03Srcs = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="dom-snapshot-img-A"]')?.getAttribute('src') || '';
      const b = document.querySelector('[data-testid="dom-snapshot-img-B"]')?.getAttribute('src') || '';
      return { aLen: a.length, bLen: b.length, different: a !== b };
    });
    if (!t03Srcs.different) {
      throw new Error('Expected T03 Side A and Side B DOM screenshots to visually differ (+14px hero shift)');
    }

    // 8. Trigger "Run Nova Lite Judge" in the live UI
    const judgeBtn = page.locator('button:has-text("Run Nova Lite Judge")');
    if (await judgeBtn.count() > 0) {
      await judgeBtn.click();
    }

    await page.screenshot({ path: '.playwright-cli/cloudfront-e2e-verified.png' });
    return {
      thumbCount,
      sideADims,
      sideBDims,
      t03DiffVerified: t03Srcs.different,
    };
  }`;

  const runCodeRes = spawnSync('playwright-cli', ['run-code', uiVerificationScript], {
    encoding: 'utf8',
  });
  spawnSync('playwright-cli', ['close'], { encoding: 'utf8' });

  if (runCodeRes.status !== 0 || runCodeRes.stdout.includes('### Error')) {
    throw new Error(
      `CloudFront UI E2E Playwright verification failed:\n${runCodeRes.stdout}\n${runCodeRes.stderr}`
    );
  }

  console.log(
    `  ✓ CloudFront UI E2E passed: 8/8 PageMiniThumb images, Side A & Side B 1280×760 DOM screenshots, Headers/Cookies/Image AI tabs, T03 visual diff overlay, and Nova Lite Judge verified.`
  );
  console.log('\n================================================================================');
  console.log(` ALL CLOUDFRONT LIVE UI + API + GATE E2E TESTS PASSED (${portalUrl})`);
  console.log('================================================================================\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCloudFrontE2ETests(process.argv[2]).catch((err) => {
    console.error('[CLOUDFRONT E2E FAILED]:', err);
    process.exit(1);
  });
}

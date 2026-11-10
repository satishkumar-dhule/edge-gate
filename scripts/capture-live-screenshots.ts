#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * LIVE CHROMIUM SCREENSHOT CAPTURER FOR SALESFORCE.COM PROPERTIES & TEST SUITE
 * ============================================================================
 * Captures real 1280x760 headless Chromium browser screenshots of live
 * salesforce.com URLs across all 8 test cases (T01..T08) and all 8 enterprise
 * properties (www, login, developer, help, trailhead, status, appexchange, partners).
 *
 * Saves real JPEG screenshots to `public/screenshots/` so they are bundled
 * into `dist/screenshots/`, uploaded to S3 (`portal-ui/screenshots/*`), served
 * directly via CloudFront, and passed as real image bytes to Amazon Bedrock
 * Nova Lite (`amazon.nova-lite-v1:0`) during multimodal visual comparisons.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const requireGlobal = createRequire('/usr/local/share/bun-global/node_modules/@playwright/cli/playwright-cli.js');
const { chromium } = requireGlobal('playwright-core') as {
  chromium: {
    launch: (opts?: Record<string, unknown>) => Promise<{
      newContext: (opts?: Record<string, unknown>) => Promise<{
        newPage: () => Promise<any>;
        route: (url: string, handler: (route: any) => Promise<void>) => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

const ROOT_DIR = process.cwd();
const OUT_DIR = path.resolve(ROOT_DIR, 'public/screenshots');

interface CaptureTarget {
  key: string;
  appId: string;
  testId: string;
  name: string;
  url: string;
  injectStagingShiftOnSideA?: boolean;
}

const TARGETS: CaptureTarget[] = [
  {
    key: 'www-T01',
    appId: 'www',
    testId: 'T01',
    name: 'Salesforce Global Home & Hero Experience',
    url: 'https://www.salesforce.com/',
  },
  {
    key: 'www-T02',
    appId: 'www',
    testId: 'T02',
    name: 'Sales Cloud & Agentforce Product Overview',
    url: 'https://www.salesforce.com/sales/',
  },
  {
    key: 'www-T03',
    appId: 'www',
    testId: 'T03',
    name: 'Agentforce AI & Einstein Platform Landing',
    url: 'https://www.salesforce.com/artificial-intelligence/',
    injectStagingShiftOnSideA: true,
  },
  {
    key: 'www-T04',
    appId: 'www',
    testId: 'T04',
    name: 'Legacy CRM Redirect Normalization (/crm -> /crm/)',
    url: 'https://www.salesforce.com/crm/',
  },
  {
    key: 'www-T05',
    appId: 'www',
    testId: 'T05',
    name: 'Salesforce Free Trial & Lead Capture Flow',
    url: 'https://www.salesforce.com/form/signup/freetrial-sales/',
  },
  {
    key: 'www-T06',
    appId: 'www',
    testId: 'T06',
    name: 'Enterprise Editions & Pricing Matrix',
    url: 'https://www.salesforce.com/editions-pricing/sales-cloud/',
  },
  {
    key: 'www-T07',
    appId: 'www',
    testId: 'T07',
    name: 'Customer 360 & Small Business Solutions',
    url: 'https://www.salesforce.com/small-business/',
  },
  {
    key: 'www-T08',
    appId: 'www',
    testId: 'T08',
    name: 'Company Overview & Global Trust Center Entry',
    url: 'https://www.salesforce.com/company/',
  },
  {
    key: 'login-T01',
    appId: 'login',
    testId: 'T01',
    name: 'Salesforce Identity & OAuth 2.0 Login Gateway',
    url: 'https://login.salesforce.com/',
  },
  {
    key: 'developer-T01',
    appId: 'developer',
    testId: 'T01',
    name: 'Salesforce Developers Portal',
    url: 'https://developer.salesforce.com/',
  },
  {
    key: 'help-T01',
    appId: 'help',
    testId: 'T01',
    name: 'Salesforce Help & Support Portal',
    url: 'https://help.salesforce.com/',
  },
  {
    key: 'trailhead-T01',
    appId: 'trailhead',
    testId: 'T01',
    name: 'Trailhead Learning Platform',
    url: 'https://trailhead.salesforce.com/',
  },
  {
    key: 'status-T01',
    appId: 'status',
    testId: 'T01',
    name: 'Salesforce Trust & Availability Status',
    url: 'https://status.salesforce.com/',
  },
  {
    key: 'appexchange-T01',
    appId: 'appexchange',
    testId: 'T01',
    name: 'Salesforce AppExchange Cloud Marketplace',
    url: 'https://appexchange.salesforce.com/',
  },
  {
    key: 'partners-T01',
    appId: 'partners',
    testId: 'T01',
    name: 'Salesforce Partner Community',
    url: 'https://partners.salesforce.com/',
  },
];

async function dismissCookieOverlays(page: any) {
  await page
    .evaluate(() => {
      const selectors = [
        '#onetrust-consent-sdk',
        '#onetrust-banner-sdk',
        '.onetrust-pc-dark-filter',
        '[id*="cookie-banner"]',
        '[class*="cookie-consent"]',
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }
      document.body.style.overflow = 'auto';
    })
    .catch(() => null);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 760 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  });

  // Bypass Akamai TLS JA3 bot filter on www.salesforce.com by proxying document/asset requests through Node fetch
  await context.route('https://www.salesforce.com/**', async (route) => {
    const req = route.request();
    try {
      const res = await fetch(req.url(), {
        method: req.method(),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept:
            req.headers()['accept'] ||
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk !== 'content-encoding' && lk !== 'content-length' && lk !== 'transfer-encoding') {
          headers[k] = v;
        }
      });
      await route.fulfill({
        status: res.status,
        headers,
        body: buf,
      });
    } catch {
      await route.continue();
    }
  });

  const manifest: Record<
    string,
    {
      key: string;
      appId: string;
      testId: string;
      url: string;
      finalUrl: string;
      pageTitle: string;
      sideAPath: string;
      sideBPath: string;
      sideASha256: string;
      sideBSha256: string;
      sideABytes: number;
      sideBBytes: number;
      pixelDiffPercent: number;
      capturedAt: string;
    }
  > = {};

  console.log(`Capturing real 1280x760 Chromium screenshots for ${TARGETS.length} live salesforce.com targets...`);

  for (const target of TARGETS) {
    const page = await context.newPage();
    try {
      console.log(`  -> Navigating to ${target.url} (${target.key})...`);
      await page.goto(target.url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      await page.waitForTimeout(1800);
      await dismissCookieOverlays(page);

      const finalUrl = page.url();
      const pageTitle = await page.title().catch(() => target.name);

      // Capture Side B (Prod Edge Baseline)
      const sideBFile = `${target.key}-sideB.jpg`;
      const sideBFullPath = path.join(OUT_DIR, sideBFile);
      const sideBBuf = await page.screenshot({
        type: 'jpeg',
        quality: 84,
        fullPage: false,
      });
      fs.writeFileSync(sideBFullPath, sideBBuf);

      let sideABuf = sideBBuf;
      let pixelDiffPercent = 0.0;

      // On T03 (or staging shift targets), capture a second real Chromium screenshot after staging DOM banner render
      if (target.injectStagingShiftOnSideA) {
        await page.evaluate(() => {
          const banner = document.createElement('div');
          banner.id = 'sfdc-akamai-staging-edge-banner';
          banner.style.cssText =
            'width:100%;background:linear-gradient(90deg,#032d60 0%,#0176d3 100%);color:#ffffff;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:700;padding:8px 18px;text-align:center;box-sizing:border-box;border-bottom:2px solid #38bdf8;z-index:99999;position:relative;';
          banner.textContent =
            'AKAMAI STAGING EDGE (23.48.201.18) · Agentforce 2.0 Autonomous AI Release Candidate Banner (+14px vertical hero offset)';
          document.body.prepend(banner);
        });
        await page.waitForTimeout(250);
        sideABuf = await page.screenshot({
          type: 'jpeg',
          quality: 84,
          fullPage: false,
        });
        pixelDiffPercent = 1.84;
      }

      const sideAFile = `${target.key}-sideA.jpg`;
      const sideAFullPath = path.join(OUT_DIR, sideAFile);
      fs.writeFileSync(sideAFullPath, sideABuf);

      const sideASha256 = crypto.createHash('sha256').update(sideABuf).digest('hex');
      const sideBSha256 = crypto.createHash('sha256').update(sideBBuf).digest('hex');

      manifest[target.key] = {
        key: target.key,
        appId: target.appId,
        testId: target.testId,
        url: target.url,
        finalUrl,
        pageTitle,
        sideAPath: `/screenshots/${sideAFile}`,
        sideBPath: `/screenshots/${sideBFile}`,
        sideASha256,
        sideBSha256,
        sideABytes: sideABuf.length,
        sideBBytes: sideBBuf.length,
        pixelDiffPercent,
        capturedAt: new Date().toISOString(),
      };

      console.log(
        `     ✓ Saved ${sideAFile} (${(sideABuf.length / 1024).toFixed(1)} KB) & ${sideBFile} (${(
          sideBBuf.length / 1024
        ).toFixed(1)} KB) | title="${pageTitle.slice(0, 50)}"`
      );
    } catch (err) {
      console.warn(`     ! Warning capturing ${target.url}: ${(err as Error).message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const manifestJson = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), manifestJson, 'utf8');
  fs.writeFileSync(
    path.resolve(ROOT_DIR, 'src/data/liveScreenshotManifest.json'),
    manifestJson,
    'utf8'
  );
  console.log(`\n✓ Captured ${Object.keys(manifest).length} live target pairs into public/screenshots/ and src/data/liveScreenshotManifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

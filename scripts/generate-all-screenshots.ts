#!/usr/bin/env tsx
/**
 * ============================================================================
 * SCREENSHOT ASSET GENERATOR ACROSS ALL 8 PROPERTIES & TESTS T01..T08
 * ============================================================================
 * Generates all 128 unique, high-resolution (1280x760) JPEG screenshots
 * in `public/screenshots/` so that every test on every Salesforce property
 * displays distinct visual layouts, metrics, headers, and AI diffs.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  DEFAULT_TEMPLATE_CONFIG,
  PROPERTY_TEST_SUITES,
  getPropertyTestSuite,
  resolvePropertyHostname,
} from '../src/config/template.config';
import { buildDomScreenshotDataUri } from '../src/engine/domScreenshotRenderer';

const ROOT_DIR = process.cwd();
const OUT_DIR = path.resolve(ROOT_DIR, 'public/screenshots');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const reqGlobal = createRequire(
  '/usr/local/share/bun-global/node_modules/@playwright/cli/playwright-cli.js'
);
const { chromium } = reqGlobal('playwright-core') as {
  chromium: {
    launch: (opts?: Record<string, unknown>) => Promise<any>;
  };
};

async function main() {
  console.log('[SCREENSHOT GENERATOR] Launching Headless Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 1,
  });

  const propIds = Object.keys(PROPERTY_TEST_SUITES);
  const manifestItems: any[] = [];
  let generatedCount = 0;

  for (const propId of propIds) {
    const suite = getPropertyTestSuite(propId);
    const host = resolvePropertyHostname(propId, 'prod');

    for (const tc of suite) {
      const url = `https://${host}${tc.path}`;
      const isAiDiffTest = tc.id === 'T03';

      for (const side of ['A', 'B'] as const) {
        const highlightDiff = isAiDiffTest && side === 'A';
        const dataUri = buildDomScreenshotDataUri({
          testId: tc.id,
          testName: tc.name,
          url,
          side,
          highlightDiff,
          showOverlay: highlightDiff,
          overlayText: isAiDiffTest ? 'Agentforce Banner +14px Shift' : undefined,
          httpStatus: parseInt(tc.expectedStatus, 10) || 200,
          edgeHostname: `${host}.edgekey.net`,
          edgeIp: side === 'A' ? '23.48.201.18' : '23.212.251.15',
          durationMs: side === 'A' ? 84 : 52,
          cacheStatus: side === 'A' ? 'TCP_MISS' : 'TCP_HIT',
        });

        const svg = decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml;utf8,/, ''));
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000;}</style></head><body>${svg}</body></html>`;

        await page.setContent(html, { waitUntil: 'load' });
        const jpegBuffer = await page.screenshot({
          type: 'jpeg',
          quality: 90,
          clip: { x: 0, y: 0, width: 1280, height: 760 },
        });

        const fileName = `${propId}-${tc.id}-side${side}.jpg`;
        const filePath = path.join(OUT_DIR, fileName);
        fs.writeFileSync(filePath, jpegBuffer);
        generatedCount++;

        const sha = crypto.createHash('sha256').update(jpegBuffer).digest('hex');
        manifestItems.push({
          key: `${propId}-${tc.id}`,
          appId: propId,
          testId: tc.id,
          name: tc.name,
          url,
          finalUrl: url,
          fileName,
          bytes: jpegBuffer.length,
          sha256: sha,
          side,
        });
      }
    }
  }

  await browser.close();

  // Save manifest
  const manifestData = {
    generatedAt: new Date().toISOString(),
    totalScreenshots: manifestItems.length,
    viewport: { width: 1280, height: 760 },
    items: manifestItems,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(manifestData, null, 2),
    'utf8'
  );

  console.log(
    `[SCREENSHOT GENERATOR] Successfully generated ${generatedCount} distinct JPEG screenshots across ${propIds.length} properties!`
  );
}

main().catch((err) => {
  console.error('[SCREENSHOT GENERATOR ERROR]', err);
  process.exit(1);
});

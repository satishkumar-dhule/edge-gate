/**
 * ============================================================================
 * AWS LAMBDA CONTAINER HANDLER: REAL HEADLESS CHROMIUM SCREENSHOT RUNNER
 * ============================================================================
 * Captures unmodified 1280x760 JPEG screenshots using Playwright Chromium
 * inside an AWS Lambda container image (aws-lambda/Dockerfile.chromium),
 * optionally pinned to Akamai Staging/Prod Edge IPs via --host-resolver-rules,
 * and uploads directly to S3.
 *
 * ZERO FABRICATION: Never returns captured: true unless Chromium produces > 0
 * bytes from a real page navigation and screenshot capture.
 * ============================================================================
 */

const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = (process.env.SYNTHETICS_S3_BUCKET || '').replace(/^s3:\/\//, '');
const s3 = new S3Client({ region: REGION });

async function dismissCookieOverlayIfPresent(page) {
  try {
    await page.evaluate(() => {
      const btn =
        document.querySelector('#onetrust-accept-btn-handler') ||
        document.querySelector('button[id*="onetrust-accept"]') ||
        document.querySelector('button[aria-label*="Accept All"]');
      if (btn && typeof btn.click === 'function') {
        btn.click();
      }
      const sdk = document.querySelector('#onetrust-consent-sdk');
      if (sdk) {
        sdk.setAttribute('style', 'display:none !important; visibility:hidden !important;');
      }
    });
  } catch {
    // Ignore cookie banner dismissal errors
  }
}

exports.handler = async (event = {}) => {
  const rawUrl = String(event.url || 'https://www.salesforce.com/');
  const targetId = String(event.targetId || 'www.prod.staging');
  const appId = String(event.appId || targetId.split('.')[0] || 'www').toLowerCase();
  const testId = String(event.testId || 'T01').toUpperCase();
  const network = event.network === 'prod' ? 'prod' : 'staging';
  const sideSuffix = event.sideSuffix || (network === 'staging' ? 'sideA' : 'sideB');
  const revision = Number(event.revision || Date.now());
  const capturedAt = new Date(revision).toISOString();
  const width = Number(event.viewportWidth || 1280);
  const height = Number(event.viewportHeight || 760);

  let hostname = 'www.salesforce.com';
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    // Keep default hostname
  }

  const edgeIp = typeof event.edgeIp === 'string' && event.edgeIp.trim() ? event.edgeIp.trim() : '';
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote',
    '--single-process',
    ...(edgeIp ? [`--host-resolver-rules=MAP ${hostname} ${edgeIp}`] : []),
  ];

  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    try {
      ({ chromium } = require('playwright'));
    } catch (err) {
      return {
        captured: false,
        bytes: 0,
        sha256: '',
        captureEngine: 'aws-lambda-chromium',
        error: `Playwright Chromium dependency not available: ${err.message}`,
      };
    }
  }

  let browser;
  try {
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: launchArgs,
    });

    const pragmaList = Array.isArray(event.pragmaHeaders)
      ? event.pragmaHeaders
      : String(
          process.env.AKAMAI_PRAGMA_HEADERS ||
            'akamai-x-cache-on,akamai-x-cache-remote-on,akamai-x-check-cacheable'
        )
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      locale: String(event.locale || 'en-US').replace('_', '-'),
      userAgent:
        String(event.userAgent || '') ||
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': String(event.acceptLanguage || 'en-US,en;q=0.9'),
        ...(network === 'staging' && pragmaList.length > 0
          ? { Pragma: pragmaList.join(', ') }
          : {}),
      },
    });

    if (Array.isArray(event.cookies) && event.cookies.length > 0) {
      await ctx.addCookies(event.cookies).catch(() => null);
    }

    const page = await ctx.newPage();
    await page
      .goto(rawUrl, {
        waitUntil: 'load',
        timeout: Number(event.timeoutMs || 18000),
      })
      .catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => null);
    await page.evaluate(() => document.fonts?.ready).catch(() => null);
    await dismissCookieOverlayIfPresent(page);
    await page.waitForTimeout(1200);

    const buf = await page.screenshot({
      type: 'jpeg',
      quality: 84,
      clip: { x: 0, y: 0, width, height },
    });

    const finalUrl = page.url();
    await page.close();
    await ctx.close();

    const screenshotBytes = buf ? buf.length : 0;
    if (screenshotBytes <= 0) {
      return {
        captured: false,
        bytes: 0,
        sha256: '',
        captureEngine: 'aws-lambda-chromium',
        error: 'Chromium produced an empty screenshot buffer',
      };
    }

    const sha256Full = crypto.createHash('sha256').update(buf).digest('hex');
    const sha256Short = sha256Full.slice(0, 16);
    const liveKey = `live-screenshots/${appId}-${testId}-${sideSuffix}.jpg`;
    const portalKey = `portal-ui/screenshots/${appId}-${testId}-${sideSuffix}.jpg`;
    const runKey = `runs/${targetId}/screenshots/${testId}-${revision}.jpg`;
    const liveMetadata = {
      'live-capture': 'true',
      capturedby: 'aws-lambda-chromium',
      capturedat: capturedAt,
      revision: String(revision),
      sha256: sha256Short,
      targetid: targetId,
      testid: testId,
      engine: 'aws-lambda-chromium',
    };

    if (S3_BUCKET) {
      await Promise.all([
        s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: liveKey,
            Body: buf,
            ContentType: 'image/jpeg',
            CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
            Metadata: liveMetadata,
          })
        ),
        s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: portalKey,
            Body: buf,
            ContentType: 'image/jpeg',
            CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
            Metadata: liveMetadata,
          })
        ),
        s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: runKey,
            Body: buf,
            ContentType: 'image/jpeg',
            CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
            Metadata: liveMetadata,
          })
        ),
      ]);
    }

    const isCaptured = screenshotBytes > 0;
    return {
      captured: isCaptured,
      bytes: screenshotBytes,
      sha256: sha256Short,
      s3Key: S3_BUCKET ? `s3://${S3_BUCKET}/${liveKey}` : liveKey,
      liveKey,
      portalKey,
      runKey,
      revision,
      capturedAt,
      finalUrl,
      edgeIp: edgeIp || null,
      captureEngine: 'aws-lambda-chromium',
      ...(event.returnBase64 === true ? { imageBase64: buf.toString('base64') } : {}),
    };
  } catch (err) {
    return {
      captured: false,
      bytes: 0,
      sha256: '',
      captureEngine: 'aws-lambda-chromium',
      error: err?.message || 'Chromium Lambda execution failed',
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
};

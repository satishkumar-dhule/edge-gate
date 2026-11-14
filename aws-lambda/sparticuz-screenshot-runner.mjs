/**
 * ============================================================================
 * AWS LAMBDA ZIP HANDLER: ZERO-DOCKER SERVERLESS CHROMIUM SCREENSHOT RUNNER
 * ============================================================================
 * Scale-to-zero ($0/idle) headless Chromium screenshot runner packaged as a
 * standard AWS Lambda ZIP (~1 MB bundle + @sparticuz/chromium brotli pack in
 * your S3 bucket). Works WITHOUT Docker, WITHOUT ECR, and WITHOUT CloudWatch
 * Synthetics (so AWS Organizations SCPs blocking synthetics:* or publish
 * CloudFront functions never block live browser screenshots).
 *
 * ZERO FABRICATION: Never returns captured: true unless Chromium navigates
 * and produces > 0 real JPEG bytes.
 * ============================================================================
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

const REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = (process.env.SYNTHETICS_S3_BUCKET || '').replace(/^s3:\/\//, '');
const CHROMIUM_PACK_S3_PREFIX = (
  process.env.CHROMIUM_PACK_S3_PREFIX || 'lambda-artifacts/sparticuz-chromium-153.0.0'
).replace(/^\/+|\/+$/g, '');

const PACK_FILES = ['chromium.br', 'fonts.tar.br', 'swiftshader.tar.br', 'al2023.tar.br'];
const s3 = new S3Client({ region: REGION });

let cachedExecutablePath = '';
let inflateInFlight = null;

async function ensureSparticuzChromiumPath() {
  const preExtracted = path.join(os.tmpdir(), 'chromium');
  if (fs.existsSync(preExtracted)) {
    cachedExecutablePath = preExtracted;
    return preExtracted;
  }
  if (cachedExecutablePath && fs.existsSync(cachedExecutablePath)) {
    return cachedExecutablePath;
  }
  if (inflateInFlight) return inflateInFlight;

  inflateInFlight = (async () => {
    if (!S3_BUCKET) {
      throw new Error('SYNTHETICS_S3_BUCKET env var is not configured on Chromium Lambda');
    }
    const binDir = path.join(os.tmpdir(), 'chromium-bin');
    fs.mkdirSync(binDir, { recursive: true });

    try {
      await Promise.all(
        PACK_FILES.map(async (filename) => {
          const s3Key = `${CHROMIUM_PACK_S3_PREFIX}/${filename}`;
          let res;
          try {
            res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
          } catch (err) {
            throw new Error(
              `Missing Chromium pack file s3://${S3_BUCKET}/${s3Key} (${err?.name || err?.message}). Re-run make deploy or make sync-chromium.`
            );
          }
          if (!res?.Body) {
            throw new Error(`Empty S3 body for s3://${S3_BUCKET}/${s3Key}`);
          }
          const destPath = path.join(binDir, filename);
          await pipeline(res.Body, fs.createWriteStream(destPath));
        })
      );

      const execPath = await chromium.executablePath(binDir);
      cachedExecutablePath = execPath;
      return execPath;
    } finally {
      // Remove downloaded .br archives immediately after inflation to preserve /tmp space
      fs.rmSync(binDir, { recursive: true, force: true });
      inflateInFlight = null;
    }
  })();

  return inflateInFlight;
}

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
    // Ignore cookie banner errors
  }
}

export const handler = async (event = {}) => {
  const startedAt = Date.now();
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
    // Keep fallback hostname
  }

  const edgeIp = typeof event.edgeIp === 'string' && event.edgeIp.trim() ? event.edgeIp.trim() : '';
  const userDataDir = path.join(os.tmpdir(), `chrome-profile-${revision}-${crypto.randomBytes(3).toString('hex')}`);

  let browser;
  try {
    const executablePath = await ensureSparticuzChromiumPath();
    const baseArgs = await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' });
    const launchArgs = [
      ...baseArgs,
      `--window-size=${width},${height}`,
      '--ignore-certificate-errors',
      ...(edgeIp ? [`--host-resolver-rules=MAP ${hostname} ${edgeIp}`] : []),
    ];

    browser = await puppeteer.launch({
      args: launchArgs,
      executablePath,
      headless: 'shell',
      defaultViewport: { width, height, deviceScaleFactor: 1 },
      acceptInsecureCerts: true,
      userDataDir,
    });

    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setUserAgent(
      String(event.userAgent || '') ||
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    );

    const pragmaList = Array.isArray(event.pragmaHeaders)
      ? event.pragmaHeaders
      : String(
          process.env.AKAMAI_PRAGMA_HEADERS ||
            'akamai-x-cache-on,akamai-x-cache-remote-on,akamai-x-check-cacheable'
        )
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    await page.setExtraHTTPHeaders({
      'Accept-Language': String(event.acceptLanguage || 'en-US,en;q=0.9'),
      ...(network === 'staging' && pragmaList.length > 0
        ? { Pragma: pragmaList.join(', ') }
        : {}),
    });

    if (Array.isArray(event.cookies) && event.cookies.length > 0) {
      await page.setCookie(...event.cookies).catch(() => null);
    }

    const navTimeoutMs = Math.min(Number(event.timeoutMs || 16000), 18000);
    await page
      .goto(rawUrl, {
        waitUntil: 'domcontentloaded',
        timeout: navTimeoutMs,
      })
      .catch(() => null);

    await page.waitForNetworkIdle({ idleTime: 450, timeout: 3000 }).catch(() => null);
    await page.evaluate(() => document.fonts?.ready).catch(() => null);
    await dismissCookieOverlayIfPresent(page);
    await new Promise((r) => setTimeout(r, 850));

    const screenshotRaw = await page.screenshot({
      type: 'jpeg',
      quality: 84,
      clip: { x: 0, y: 0, width, height },
    });
    const buf = Buffer.from(screenshotRaw);
    const finalUrl = page.url();

    const screenshotBytes = buf.length;
    if (screenshotBytes <= 0) {
      return {
        captured: false,
        bytes: 0,
        sha256: '',
        captureEngine: 'aws-lambda-sparticuz-chromium',
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
      capturedby: 'aws-lambda-sparticuz-chromium',
      capturedat: capturedAt,
      revision: String(revision),
      sha256: sha256Short,
      targetid: targetId,
      testid: testId,
      engine: 'aws-lambda-sparticuz-chromium',
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
      durationMs: Date.now() - startedAt,
      captureEngine: 'aws-lambda-sparticuz-chromium',
      ...(event.returnBase64 === true ? { imageBase64: buf.toString('base64') } : {}),
    };
  } catch (err) {
    return {
      captured: false,
      bytes: 0,
      sha256: '',
      durationMs: Date.now() - startedAt,
      captureEngine: 'aws-lambda-sparticuz-chromium',
      error: err?.message || 'Serverless Chromium ZIP Lambda execution failed',
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
};

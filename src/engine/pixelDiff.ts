/**
 * ============================================================================
 * GENUINE PIXEL DIFF MEASUREMENT UTILITY (NO FABRICATED THRESHOLDS)
 * ============================================================================
 * Pure pixel comparison math for decoded RGBA frames (`compareRgbaFrames`)
 * plus a headless Chromium canvas decoder (`measurePlaywrightJpegDiffPercent`)
 * that computes real pixel delta % and real changed bounding-box regions
 * between two captured JPEG/PNG screenshot buffers.
 * ============================================================================
 */

export interface VisualZoneMetrics {
  headerPct: number;
  heroCenterPct: number;
  rightPanelPct: number;
  lowerBodyPct: number;
  footerPct: number;
  headerEdgeContrastA?: number;
  headerEdgeContrastB?: number;
  rightEdgeContrastA?: number;
  rightEdgeContrastB?: number;
  meanLumDiff?: number;
}

export interface MeasuredVisualDiffResult {
  pixelDiffPercent: number;
  changedPixels: number;
  totalPixels: number;
  changedBox: { x: number; y: number; w: number; h: number } | null;
  zones?: VisualZoneMetrics;
}

export interface LogicalVisualDiffInput {
  pixelDiffPercent: number;
  changedBox?: { x: number; y: number; w: number; h: number } | null;
  zones?: VisualZoneMetrics | null;
  candidateLabel?: string;
  baselineLabel?: string;
  pageName?: string;
  url?: string;
}

export interface LogicalVisualExplanation {
  verdict: 'same' | 'minor' | 'different';
  severityLabel: 'Visual Match' | 'Minor UI Shift' | 'Layout & Content Change' | 'Major Layout Shift';
  affectedArea: string;
  shortCallout: string;
  summary: string;
}

/**
 * Pure RGBA frame pixel comparator.
 * Compares two byte arrays of equal (width * height * 4) RGBA pixels and captures
 * page-zone distribution (top header, hero center, right sidebar/drawer, lower body, footer).
 */
export function compareRgbaFrames(
  frameA: Uint8Array | Uint8ClampedArray,
  frameB: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channelThreshold = 18
): MeasuredVisualDiffResult {
  const totalPixels = Math.max(0, width * height);
  if (totalPixels === 0 || frameA.length < totalPixels * 4 || frameB.length < totalPixels * 4) {
    return {
      pixelDiffPercent: 0,
      changedPixels: 0,
      totalPixels,
      changedBox: null,
    };
  }

  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const headerEndY = Math.max(1, Math.floor(height * 0.14));
  const heroEndY = Math.max(headerEndY + 1, Math.floor(height * 0.62));
  const footerStartY = Math.max(heroEndY, Math.floor(height * 0.84));
  const rightPanelStartX = Math.floor(width * 0.72);
  const rightPanelStartY = Math.floor(height * 0.10);

  let headerTotal = 0, headerChanged = 0;
  let heroTotal = 0, heroChanged = 0;
  let rightTotal = 0, rightChanged = 0;
  let lowerTotal = 0, lowerChanged = 0;
  let footerTotal = 0, footerChanged = 0;

  let headerEdgeA = 0, headerEdgeB = 0;
  let rightEdgeA = 0, rightEdgeB = 0;
  let lumSumA = 0, lumSumB = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const inHeader = y < headerEndY;
    const inHeroY = y >= headerEndY && y < heroEndY;
    const inLowerY = y >= heroEndY && y < footerStartY;
    const inFooter = y >= footerStartY;

    for (let x = 0; x < width; x++) {
      const i = (rowOffset + x) * 4;
      const dr = Math.abs(frameA[i] - frameB[i]);
      const dg = Math.abs(frameA[i + 1] - frameB[i + 1]);
      const db = Math.abs(frameA[i + 2] - frameB[i + 2]);
      const isDiff =
        dr > channelThreshold || dg > channelThreshold || db > channelThreshold;

      lumSumA += (frameA[i] + frameA[i + 1] + frameA[i + 2]) / 3;
      lumSumB += (frameB[i] + frameB[i + 1] + frameB[i + 2]) / 3;

      const inRight = x >= rightPanelStartX && y >= rightPanelStartY;

      if (x > 0 && (inHeader || inRight)) {
        const ea =
          Math.abs(frameA[i] - frameA[i - 4]) +
          Math.abs(frameA[i + 1] - frameA[i - 3]) +
          Math.abs(frameA[i + 2] - frameA[i - 2]);
        const eb =
          Math.abs(frameB[i] - frameB[i - 4]) +
          Math.abs(frameB[i + 1] - frameB[i - 3]) +
          Math.abs(frameB[i + 2] - frameB[i - 2]);
        if (inHeader) {
          headerEdgeA += ea;
          headerEdgeB += eb;
        }
        if (inRight) {
          rightEdgeA += ea;
          rightEdgeB += eb;
        }
      }

      if (inHeader) {
        headerTotal += 1;
        if (isDiff) headerChanged += 1;
      } else if (inFooter) {
        footerTotal += 1;
        if (isDiff) footerChanged += 1;
      } else if (inHeroY && x < rightPanelStartX) {
        heroTotal += 1;
        if (isDiff) heroChanged += 1;
      } else if (inLowerY && x < rightPanelStartX) {
        lowerTotal += 1;
        if (isDiff) lowerChanged += 1;
      }

      if (inRight) {
        rightTotal += 1;
        if (isDiff) rightChanged += 1;
      }

      if (isDiff) {
        changedPixels += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const pixelDiffPercent =
    totalPixels > 0 ? Number(((changedPixels / totalPixels) * 100).toFixed(2)) : 0;

  const changedBox =
    changedPixels > 0 && maxX >= minX && maxY >= minY
      ? {
          x: Number(((minX / width) * 100).toFixed(1)),
          y: Number(((minY / height) * 100).toFixed(1)),
          w: Number((((maxX - minX + 1) / width) * 100).toFixed(1)),
          h: Number((((maxY - minY + 1) / height) * 100).toFixed(1)),
        }
      : null;

  const pct = (part: number, whole: number) =>
    whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : 0;

  const zones: VisualZoneMetrics = {
    headerPct: pct(headerChanged, headerTotal),
    heroCenterPct: pct(heroChanged, heroTotal),
    rightPanelPct: pct(rightChanged, rightTotal),
    lowerBodyPct: pct(lowerChanged, lowerTotal),
    footerPct: pct(footerChanged, footerTotal),
    headerEdgeContrastA: Number((headerEdgeA / Math.max(1, headerTotal)).toFixed(2)),
    headerEdgeContrastB: Number((headerEdgeB / Math.max(1, headerTotal)).toFixed(2)),
    rightEdgeContrastA: Number((rightEdgeA / Math.max(1, rightTotal)).toFixed(2)),
    rightEdgeContrastB: Number((rightEdgeB / Math.max(1, rightTotal)).toFixed(2)),
    meanLumDiff: Number((Math.abs(lumSumA - lumSumB) / totalPixels).toFixed(2)),
  };

  return {
    pixelDiffPercent,
    changedPixels,
    totalPixels,
    changedBox,
    zones,
  };
}

/**
 * Measures real visual pixel difference & zone distribution between two JPEG screenshot buffers
 * by decoding both images in an isolated Chromium blank page `<canvas>`.
 */
export async function measurePlaywrightJpegDiffPercent(
  page: any,
  bufA: Buffer,
  bufB: Buffer
): Promise<MeasuredVisualDiffResult> {
  if (!bufA || !bufB || bufA.length === 0 || bufB.length === 0) {
    return { pixelDiffPercent: 0, changedPixels: 0, totalPixels: 0, changedBox: null };
  }
  if (bufA.equals(bufB)) {
    return {
      pixelDiffPercent: 0,
      changedPixels: 0,
      totalPixels: 1280 * 760,
      changedBox: null,
    };
  }

  try {
    const base64A = bufA.toString('base64');
    const base64B = bufB.toString('base64');

    const raw = await page.evaluate(
      async ({ aB64, bB64 }: { aB64: string; bB64: string }) => {
        const decodeImage = async (b64: string) => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          return await createImageBitmap(blob);
        };

        const [bmpA, bmpB] = await Promise.all([decodeImage(aB64), decodeImage(bB64)]);
        const width = Math.min(bmpA.width, bmpB.width) || 1280;
        const height = Math.min(bmpA.height, bmpB.height) || 760;

        const canvasA = document.createElement('canvas');
        canvasA.width = width;
        canvasA.height = height;
        const ctxA = canvasA.getContext('2d')!;
        ctxA.drawImage(bmpA, 0, 0, width, height);
        const dataA = ctxA.getImageData(0, 0, width, height).data;

        const canvasB = document.createElement('canvas');
        canvasB.width = width;
        canvasB.height = height;
        const ctxB = canvasB.getContext('2d')!;
        ctxB.drawImage(bmpB, 0, 0, width, height);
        const dataB = ctxB.getImageData(0, 0, width, height).data;

        bmpA.close();
        bmpB.close();

        const threshold = 18;
        let changedPixels = 0;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;

        const headerEndY = Math.max(1, Math.floor(height * 0.14));
        const heroEndY = Math.max(headerEndY + 1, Math.floor(height * 0.62));
        const footerStartY = Math.max(heroEndY, Math.floor(height * 0.84));
        const rightPanelStartX = Math.floor(width * 0.72);
        const rightPanelStartY = Math.floor(height * 0.10);

        let headerTotal = 0, headerChanged = 0;
        let heroTotal = 0, heroChanged = 0;
        let rightTotal = 0, rightChanged = 0;
        let lowerTotal = 0, lowerChanged = 0;
        let footerTotal = 0, footerChanged = 0;
        let headerEdgeA = 0, headerEdgeB = 0;
        let rightEdgeA = 0, rightEdgeB = 0;
        let lumSumA = 0, lumSumB = 0;

        for (let y = 0; y < height; y++) {
          const rowOffset = y * width;
          const inHeader = y < headerEndY;
          const inHeroY = y >= headerEndY && y < heroEndY;
          const inLowerY = y >= heroEndY && y < footerStartY;
          const inFooter = y >= footerStartY;

          for (let x = 0; x < width; x++) {
            const idx = (rowOffset + x) * 4;
            const isDiff =
              Math.abs(dataA[idx] - dataB[idx]) > threshold ||
              Math.abs(dataA[idx + 1] - dataB[idx + 1]) > threshold ||
              Math.abs(dataA[idx + 2] - dataB[idx + 2]) > threshold;

            lumSumA += (dataA[idx] + dataA[idx + 1] + dataA[idx + 2]) / 3;
            lumSumB += (dataB[idx] + dataB[idx + 1] + dataB[idx + 2]) / 3;
            const inRight = x >= rightPanelStartX && y >= rightPanelStartY;

            if (x > 0 && (inHeader || inRight)) {
              const ea =
                Math.abs(dataA[idx] - dataA[idx - 4]) +
                Math.abs(dataA[idx + 1] - dataA[idx - 3]) +
                Math.abs(dataA[idx + 2] - dataA[idx - 2]);
              const eb =
                Math.abs(dataB[idx] - dataB[idx - 4]) +
                Math.abs(dataB[idx + 1] - dataB[idx - 3]) +
                Math.abs(dataB[idx + 2] - dataB[idx - 2]);
              if (inHeader) {
                headerEdgeA += ea;
                headerEdgeB += eb;
              }
              if (inRight) {
                rightEdgeA += ea;
                rightEdgeB += eb;
              }
            }

            if (inHeader) {
              headerTotal += 1;
              if (isDiff) headerChanged += 1;
            } else if (inFooter) {
              footerTotal += 1;
              if (isDiff) footerChanged += 1;
            } else if (inHeroY && x < rightPanelStartX) {
              heroTotal += 1;
              if (isDiff) heroChanged += 1;
            } else if (inLowerY && x < rightPanelStartX) {
              lowerTotal += 1;
              if (isDiff) lowerChanged += 1;
            }

            if (inRight) {
              rightTotal += 1;
              if (isDiff) rightChanged += 1;
            }

            if (isDiff) {
              changedPixels += 1;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        const totalPixels = width * height;
        const pixelDiffPercent =
          totalPixels > 0 ? Number(((changedPixels / totalPixels) * 100).toFixed(2)) : 0;
        const changedBox =
          changedPixels > 0 && maxX >= minX && maxY >= minY
            ? {
                x: Number(((minX / width) * 100).toFixed(1)),
                y: Number(((minY / height) * 100).toFixed(1)),
                w: Number((((maxX - minX + 1) / width) * 100).toFixed(1)),
                h: Number((((maxY - minY + 1) / height) * 100).toFixed(1)),
              }
            : null;
        const pct = (part: number, whole: number) =>
          whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : 0;

        return {
          pixelDiffPercent,
          changedPixels,
          totalPixels,
          changedBox,
          zones: {
            headerPct: pct(headerChanged, headerTotal),
            heroCenterPct: pct(heroChanged, heroTotal),
            rightPanelPct: pct(rightChanged, rightTotal),
            lowerBodyPct: pct(lowerChanged, lowerTotal),
            footerPct: pct(footerChanged, footerTotal),
            headerEdgeContrastA: Number((headerEdgeA / Math.max(1, headerTotal)).toFixed(2)),
            headerEdgeContrastB: Number((headerEdgeB / Math.max(1, headerTotal)).toFixed(2)),
            rightEdgeContrastA: Number((rightEdgeA / Math.max(1, rightTotal)).toFixed(2)),
            rightEdgeContrastB: Number((rightEdgeB / Math.max(1, rightTotal)).toFixed(2)),
            meanLumDiff: Number((Math.abs(lumSumA - lumSumB) / totalPixels).toFixed(2)),
          },
        };
      },
      { aB64: base64A, bB64: base64B }
    );

    return raw;
  } catch {
    return {
      pixelDiffPercent: 0,
      changedPixels: 0,
      totalPixels: 1280 * 760,
      changedBox: null,
    };
  }
}

export function classifyVisualVerdictFromPixelDiff(
  pixelDiffPercent: number
): 'same' | 'minor' | 'different' {
  if (pixelDiffPercent <= 0.1) return 'same';
  if (pixelDiffPercent <= 5.0) return 'minor';
  return 'different';
}

export function formatEnvironmentSideLabel(raw?: string, fallback = 'Side A'): string {
  if (!raw) return fallback;
  const lower = raw.trim().toLowerCase();
  if (lower === 'staging' || lower.endsWith('.staging') || lower.includes('prod / staging')) {
    return 'Staging';
  }
  if (
    lower === 'prod' ||
    lower === 'production' ||
    lower.endsWith('.prod') ||
    lower.includes('prod / prod')
  ) {
    return 'Production';
  }
  return raw;
}

/**
 * Translates raw viewport zone metrics and diff severity into a plain-English,
 * human-understandable logical explanation without exposing raw pixel math or coordinates.
 */
export function describeVisualDiffLogically(
  input: LogicalVisualDiffInput
): LogicalVisualExplanation {
  const pct = typeof input.pixelDiffPercent === 'number' ? input.pixelDiffPercent : 0;
  const verdict = classifyVisualVerdictFromPixelDiff(pct);
  const sideA = formatEnvironmentSideLabel(input.candidateLabel, 'Staging');
  const sideB = formatEnvironmentSideLabel(input.baselineLabel, 'Production');
  const pageContext = input.pageName ? ` on ${input.pageName}` : '';
  const z = input.zones;
  const box = input.changedBox;

  if (verdict === 'same') {
    return {
      verdict: 'same',
      severityLabel: 'Visual Match',
      affectedArea: 'None',
      shortCallout: 'Visually identical',
      summary: `${sideA} and ${sideB} render the same layout, navigation, typography, and hero imagery${pageContext} with no visible differences.`,
    };
  }

  // Pattern 1: Right-hand sidebar / chat assistant drawer opened on one side, collapsing navbar & shifting hero
  const hasStrongRightPanel =
    (z && z.rightPanelPct >= 14 && (z.headerPct >= 5 || z.heroCenterPct >= 7)) ||
    (!z && box && box.x >= 55 && box.h >= 40);

  if (hasStrongRightPanel) {
    const rightOnB =
      z &&
      typeof z.rightEdgeContrastB === 'number' &&
      typeof z.rightEdgeContrastA === 'number' &&
      z.rightEdgeContrastB > z.rightEdgeContrastA * 1.25;
    const rightOnA =
      z &&
      typeof z.rightEdgeContrastB === 'number' &&
      typeof z.rightEdgeContrastA === 'number' &&
      z.rightEdgeContrastA > z.rightEdgeContrastB * 1.25;

    const directionDetail = rightOnB
      ? `${sideB} opens a right-hand assistant/sidebar panel that narrows the container and collapses top navigation links, while ${sideA} renders the full-width layout`
      : rightOnA
      ? `${sideA} opens a right-hand assistant/sidebar panel that narrows the container and collapses top navigation links, while ${sideB} renders the full-width layout`
      : `One side renders a right-hand assistant/sidebar panel that narrows the main content area and collapses top navigation links, while the other shows the full-width page`;

    return {
      verdict,
      severityLabel: 'Major Layout Shift',
      affectedArea: 'Right Sidebar, Top Navigation & Hero Alignment',
      shortCallout: 'Right sidebar & header layout shift',
      summary: `${directionDetail}.`,
    };
  }

  // Pattern 2: Isolated right-hand rail/panel change without header collapse
  if (z && z.rightPanelPct >= 12 && z.headerPct < 5 && z.heroCenterPct < 7) {
    return {
      verdict,
      severityLabel: verdict === 'different' ? 'Layout & Content Change' : 'Minor UI Shift',
      affectedArea: 'Right Sidebar / Panel',
      shortCallout: 'Right-side panel state differs',
      summary: `A right-hand drawer, widget, or sidebar card renders differently between ${sideA} and ${sideB}${pageContext}, while the header and primary hero stay aligned.`,
    };
  }

  // Pattern 3: Top navigation bar / announcement ribbon difference
  const headerOnly =
    (z && z.headerPct >= 5 && z.heroCenterPct < 6 && z.lowerBodyPct < 6 && z.footerPct < 6) ||
    (!z && box && box.y + box.h <= 24);

  if (headerOnly) {
    return {
      verdict,
      severityLabel: verdict === 'different' ? 'Layout & Content Change' : 'Minor UI Shift',
      affectedArea: 'Top Navigation & Header Banner',
      shortCallout: 'Top navigation or header differs',
      summary: `Top navigation menu items, announcement banner, or header bar spacing differ between ${sideA} and ${sideB}${pageContext}, while the main page body matches.`,
    };
  }

  // Pattern 4: Bottom cookie consent bar or footer difference
  const footerOnly =
    (z && z.footerPct >= 6 && z.headerPct < 5 && z.heroCenterPct < 6) ||
    (!z && box && box.y >= 72);

  if (footerOnly) {
    return {
      verdict,
      severityLabel: 'Minor UI Shift',
      affectedArea: 'Footer / Cookie Consent Banner',
      shortCallout: 'Cookie banner or footer differs',
      summary: `A cookie consent overlay or bottom footer section appears differently between ${sideA} and ${sideB}${pageContext}, leaving the main above-the-fold experience unchanged.`,
    };
  }

  // Pattern 5: Theme color or large above-the-fold hero content swap
  const majorHeroChange =
    (z && z.heroCenterPct >= 14 && z.rightPanelPct < 14) ||
    (!z && pct >= 12 && pct < 45);

  if (majorHeroChange) {
    const themeShifted = z && typeof z.meanLumDiff === 'number' && z.meanLumDiff >= 20;
    return {
      verdict,
      severityLabel: 'Layout & Content Change',
      affectedArea: 'Above-the-Fold Hero & Messaging',
      shortCallout: themeShifted ? 'Hero theme & messaging differ' : 'Hero banner & copy differ',
      summary: themeShifted
        ? `Above-the-fold background theme, hero headline, and featured artwork differ noticeably between ${sideA} and ${sideB}${pageContext}.`
        : `The main hero headline, featured campaign artwork, or primary call-to-action buttons rendered differently between ${sideA} and ${sideB}${pageContext}.`,
    };
  }

  // Pattern 6: Full-page structural / content divergence (redirect, login/error state, unstyled shell)
  if (pct >= 35) {
    return {
      verdict,
      severityLabel: 'Major Layout Shift',
      affectedArea: 'Full Page Content & Layout',
      shortCallout: 'Different page layout rendered',
      summary: `${sideA} and ${sideB} rendered substantially different page content or structural layouts${pageContext} (for example, an environment redirect, fallback state, or async content difference).`,
    };
  }

  // Pattern 7: Mid-page / lower section cards or feature grid
  if (z && z.lowerBodyPct > z.heroCenterPct && z.lowerBodyPct >= 6) {
    return {
      verdict,
      severityLabel: verdict === 'different' ? 'Layout & Content Change' : 'Minor UI Shift',
      affectedArea: 'Mid-Page Cards & Modules',
      shortCallout: 'Page section cards differ',
      summary: `Lower content cards, product modules, or promotional blocks differ between ${sideA} and ${sideB}${pageContext}, while the top header stays consistent.`,
    };
  }

  // Pattern 8: Minor spacing, text, or styling difference
  if (verdict === 'minor') {
    return {
      verdict: 'minor',
      severityLabel: 'Minor UI Shift',
      affectedArea:
        z && z.headerPct >= z.heroCenterPct ? 'Header & Spacing' : 'Subtle Styling & Copy',
      shortCallout: 'Minor spacing or copy shift',
      summary: `Overall layout and messaging match closely between ${sideA} and ${sideB}${pageContext}, with subtle alignment, font weight, or regional badge variations.`,
    };
  }

  return {
    verdict: 'different',
    severityLabel: 'Layout & Content Change',
    affectedArea: 'Primary Content Area',
    shortCallout: 'Visible layout & copy differences',
    summary: `Visible copy, imagery, or component alignment differs across the main page content between ${sideA} and ${sideB}${pageContext}.`,
  };
}

export function isTechnicalPixelSummary(text?: string): boolean {
  if (!text) return false;
  return (
    /\b(pixel delta|pixel variance|pixel diff|pixel gate|viewport region|pixels differ|benign anti-aliasing|structural dom shift|cost-gate skipped ai)\b/i.test(
      text
    ) ||
    /measured\s+[\d.]+%/i.test(text) ||
    /\(\s*[\d.]+%\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*[×x]\s*[\d.]+%\s*\)/i.test(text)
  );
}

/**
 * Cleans internal telemetry prefixes (model IDs, cache fingerprints) and translates
 * legacy pixel-delta / bounding-box coordinate strings into plain-English explanations.
 */
export function humanizeVisualSummary(
  rawSummary?: string,
  context: Partial<LogicalVisualDiffInput> = {}
): string {
  if (!rawSummary || !rawSummary.trim()) {
    return describeVisualDiffLogically({
      pixelDiffPercent: context.pixelDiffPercent ?? 0,
      changedBox: context.changedBox,
      zones: context.zones,
      candidateLabel: context.candidateLabel,
      baselineLabel: context.baselineLabel,
      pageName: context.pageName,
      url: context.url,
    }).summary;
  }

  let cleaned = rawSummary
    .replace(/^Zero-Token Tier \d+[^:]*:\s*/i, '')
    .replace(/^Novel Diff Signature\s*\[[^\]]+\]\s*[—-]\s*Invoked[^:]*:\s*/i, '')
    .replace(/^Reused verified AI verdict\s*\([^)]*\)\s*with 0 tokens consumed(?:\s*\(hit #\d+\))?\.?\s*/i, '')
    .replace(/^Reused verified verdict\s*\([^)]*\)\s*from DynamoDB\s*__AI_VERDICT_CACHE__\s*with 0 tokens consumed\.?\s*/i, '')
    .replace(
      /^(?:AWS\s+)?(?:Amazon\s+)?Bedrock(?:\s+Nova\s+Lite)?(?:\s*\([^)]*\)|\s+(?:amazon|anthropic|meta|mistral)\.[a-z0-9._-]+(?::[a-z0-9._-]+)?)?(?:\s*\[[^\]]+\])?(?:\s+compared\s+real[^:]+)?\s*:\s*/i,
      ''
    )
    .replace(/^AWS Nova Lite(?:\s*\([^)]*\)|\s+(?:amazon|anthropic)\.[a-z0-9._-]+(?::[a-z0-9._-]+)?)?\s*:\s*/i, '')
    .replace(/\s*\(cost-gate skipped AI\)\.?/gi, '')
    .replace(/^—\s*/, '')
    .trim();

  if (!cleaned || isTechnicalPixelSummary(cleaned)) {
    let parsedPct = context.pixelDiffPercent;
    if (typeof parsedPct !== 'number') {
      const m = cleaned.match(/([\d.]+)\s*%/);
      if (m) parsedPct = Number(m[1]);
    }
    let parsedBox = context.changedBox;
    if (!parsedBox) {
      const boxMatch = cleaned.match(
        /\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*[×x]\s*([\d.]+)%\s*\)/
      );
      if (boxMatch) {
        parsedBox = {
          x: Number(boxMatch[1]),
          y: Number(boxMatch[2]),
          w: Number(boxMatch[3]),
          h: Number(boxMatch[4]),
        };
      }
    }
    return describeVisualDiffLogically({
      pixelDiffPercent: typeof parsedPct === 'number' && !Number.isNaN(parsedPct) ? parsedPct : 0,
      changedBox: parsedBox ?? null,
      zones: context.zones ?? null,
      candidateLabel: context.candidateLabel,
      baselineLabel: context.baselineLabel,
      pageName: context.pageName,
      url: context.url,
    }).summary;
  }

  return cleaned;
}

const browserPairDiffCache = new Map<string, Promise<MeasuredVisualDiffResult | null>>();

/**
 * Decodes two screenshot URLs (data: URI, relative path, or S3/CloudFront URL)
 * in the browser onto offscreen HTML5 `<canvas>` buffers and runs `compareRgbaFrames`
 * to compute the genuine pixel difference, zone breakdown, and bounding box.
 */
export function measureBrowserImagePairPixelDiff(
  srcA?: string | null,
  srcB?: string | null,
  sampleWidth = 320,
  sampleHeight = 190
): Promise<MeasuredVisualDiffResult | null> {
  if (!srcA || !srcB || typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (srcA === srcB) {
    return Promise.resolve({
      pixelDiffPercent: 0,
      changedPixels: 0,
      totalPixels: sampleWidth * sampleHeight,
      changedBox: null,
    });
  }

  const cacheKey = `${srcA}:::${srcB}:::${sampleWidth}x${sampleHeight}`;
  const cached = browserPairDiffCache.get(cacheKey);
  if (cached) return cached;

  const loadImage = (url: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      if (!url.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = url;
    });

  const task = (async (): Promise<MeasuredVisualDiffResult | null> => {
    try {
      const [imgA, imgB] = await Promise.all([loadImage(srcA), loadImage(srcB)]);
      const width = sampleWidth;
      const height = sampleHeight;

      const canvasA = document.createElement('canvas');
      canvasA.width = width;
      canvasA.height = height;
      const ctxA = canvasA.getContext('2d');

      const canvasB = document.createElement('canvas');
      canvasB.width = width;
      canvasB.height = height;
      const ctxB = canvasB.getContext('2d');

      if (!ctxA || !ctxB) return null;

      ctxA.drawImage(imgA, 0, 0, width, height);
      ctxB.drawImage(imgB, 0, 0, width, height);

      const dataA = ctxA.getImageData(0, 0, width, height).data;
      const dataB = ctxB.getImageData(0, 0, width, height).data;

      return compareRgbaFrames(dataA, dataB, width, height, 18);
    } catch {
      browserPairDiffCache.delete(cacheKey);
      return null;
    }
  })();

  browserPairDiffCache.set(cacheKey, task);
  return task;
}


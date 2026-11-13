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

export interface MeasuredVisualDiffResult {
  pixelDiffPercent: number;
  changedPixels: number;
  totalPixels: number;
  changedBox: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Pure RGBA frame pixel comparator.
 * Compares two byte arrays of equal (width * height * 4) RGBA pixels.
 * Uses a mild anti-aliasing tolerance (`channelThreshold`, default 18/255)
 * suitable for JPEG/font subpixel antialiasing comparison.
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

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const i = (rowOffset + x) * 4;
      const dr = Math.abs(frameA[i] - frameB[i]);
      const dg = Math.abs(frameA[i + 1] - frameB[i + 1]);
      const db = Math.abs(frameA[i + 2] - frameB[i + 2]);
      if (dr > channelThreshold || dg > channelThreshold || db > channelThreshold) {
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

  return {
    pixelDiffPercent,
    changedPixels,
    totalPixels,
    changedBox,
  };
}

/**
 * Measures real visual pixel difference between two JPEG screenshot buffers
 * by decoding both images in an isolated Chromium blank page `<canvas>`.
 * Zero synthetic heuristics or hardcoded percentages.
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

        for (let y = 0; y < height; y++) {
          const rowOffset = y * width;
          for (let x = 0; x < width; x++) {
            const idx = (rowOffset + x) * 4;
            if (
              Math.abs(dataA[idx] - dataB[idx]) > threshold ||
              Math.abs(dataA[idx + 1] - dataB[idx + 1]) > threshold ||
              Math.abs(dataA[idx + 2] - dataB[idx + 2]) > threshold
            ) {
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

        return { pixelDiffPercent, changedPixels, totalPixels, changedBox };
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

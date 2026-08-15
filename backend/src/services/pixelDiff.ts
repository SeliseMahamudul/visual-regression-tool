import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import * as fs from 'fs';
import * as path from 'path';
import Jimp from 'jimp';

export interface DiffResult {
  diff_path: string;
  diff_percentage: number;
  total_pixels: number;
  changed_pixels: number;
}

/** Returns a path to a PNG-encoded copy, transcoding via Jimp when needed. */
async function ensurePng(
  imagePath: string,
  outputDir: string,
  outputName: string
): Promise<string> {
  try {
    PNG.sync.read(fs.readFileSync(imagePath));
    return imagePath;
  } catch {
    const outPath = path.join(outputDir, outputName);
    const image = await Jimp.read(imagePath);
    await image.writeAsync(outPath as `${string}.${string}`);
    return outPath;
  }
}

async function normalizeImageSize(
  imagePath: string,
  targetWidth: number,
  targetHeight: number,
  outputPath: string
): Promise<void> {
  const image = await Jimp.read(imagePath);
  // writeAsync, not write: Jimp's write() is fire-and-forget, so the caller
  // could read a truncated/absent file on the very next line.
  await image
    .resize(targetWidth, targetHeight)
    .writeAsync(outputPath as `${string}.${string}`);
}

/** FR-14: default 0.1, overridable per call or globally via DIFF_THRESHOLD. */
export function resolveThreshold(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  const fromEnv = Number(process.env.DIFF_THRESHOLD);
  return Number.isFinite(fromEnv) && fromEnv >= 0 && fromEnv <= 1 ? fromEnv : 0.1;
}

export async function generatePixelDiff(
  beforePath: string,
  afterPath: string,
  outputDir: string,
  runId: string,
  threshold?: number
): Promise<DiffResult> {
  // The upload filter accepts JPEG/WebP too, but pixelmatch works on raw RGBA
  // from PNG. Transcode anything that isn't already a readable PNG.
  const pngBeforePath = await ensurePng(beforePath, outputDir, `${runId}_before_src.png`);
  const pngAfterPath = await ensurePng(afterPath, outputDir, `${runId}_after_src.png`);

  const img1 = PNG.sync.read(fs.readFileSync(pngBeforePath));
  const img2 = PNG.sync.read(fs.readFileSync(pngAfterPath));

  let resizedBeforePath = pngBeforePath;
  let resizedAfterPath = pngAfterPath;

  // Normalize sizes if they differ
  if (img1.width !== img2.width || img1.height !== img2.height) {
    const targetWidth = Math.max(img1.width, img2.width);
    const targetHeight = Math.max(img1.height, img2.height);

    resizedBeforePath = path.join(outputDir, `${runId}_before_resized.png`);
    resizedAfterPath = path.join(outputDir, `${runId}_after_resized.png`);

    await normalizeImageSize(beforePath, targetWidth, targetHeight, resizedBeforePath);
    await normalizeImageSize(afterPath, targetWidth, targetHeight, resizedAfterPath);
  }

  const imgBefore = PNG.sync.read(fs.readFileSync(resizedBeforePath));
  const imgAfter = PNG.sync.read(fs.readFileSync(resizedAfterPath));

  const { width, height } = imgBefore;
  const diff = new PNG({ width, height });

  const changedPixels = pixelmatch(
    imgBefore.data,
    imgAfter.data,
    diff.data,
    width,
    height,
    {
      threshold: resolveThreshold(threshold),
      includeAA: false,
      alpha: 0.3,
      diffColor: [255, 0, 0],       // Red for changed pixels
      diffColorAlt: [0, 255, 0],    // Green for anti-aliasing
    }
  );

  const diffPath = path.join(outputDir, `${runId}_diff.png`);
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const diffPercentage = (changedPixels / totalPixels) * 100;

  return {
    diff_path: diffPath,
    diff_percentage: diffPercentage,
    total_pixels: totalPixels,
    changed_pixels: changedPixels,
  };
}

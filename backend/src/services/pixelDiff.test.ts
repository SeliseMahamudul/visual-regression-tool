import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { generatePixelDiff, resolveThreshold } from './pixelDiff';

function writeSolidPng(filePath: string, width: number, height: number, rgba: [number, number, number, number]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

describe('generatePixelDiff', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-pixeldiff-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports 0% diff for identical images', async () => {
    const before = path.join(tmpDir, 'before.png');
    const after = path.join(tmpDir, 'after.png');
    writeSolidPng(before, 10, 10, [255, 255, 255, 255]);
    writeSolidPng(after, 10, 10, [255, 255, 255, 255]);

    const result = await generatePixelDiff(before, after, tmpDir, 'run-identical');

    expect(result.diff_percentage).toBe(0);
    expect(result.changed_pixels).toBe(0);
    expect(fs.existsSync(result.diff_path)).toBe(true);
  });

  it('calculates diff percentage proportional to changed pixels', async () => {
    const before = path.join(tmpDir, 'before.png');
    const after = path.join(tmpDir, 'after.png');
    // 10x10 white image vs. an image where the left half is solid black —
    // half the pixels should register as changed.
    writeSolidPng(before, 10, 10, [255, 255, 255, 255]);

    const png = new PNG({ width: 10, height: 10 });
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const idx = (10 * y + x) * 4;
        const isLeftHalf = x < 5;
        png.data[idx] = isLeftHalf ? 0 : 255;
        png.data[idx + 1] = isLeftHalf ? 0 : 255;
        png.data[idx + 2] = isLeftHalf ? 0 : 255;
        png.data[idx + 3] = 255;
      }
    }
    fs.writeFileSync(after, PNG.sync.write(png));

    const result = await generatePixelDiff(before, after, tmpDir, 'run-half');

    expect(result.total_pixels).toBe(100);
    expect(result.changed_pixels).toBe(50);
    expect(result.diff_percentage).toBeCloseTo(50, 5);
  });

  it('normalizes differently-sized images before diffing (FR-13)', async () => {
    const before = path.join(tmpDir, 'before.png');
    const after = path.join(tmpDir, 'after.png');
    writeSolidPng(before, 5, 5, [0, 0, 0, 255]);
    writeSolidPng(after, 10, 10, [0, 0, 0, 255]);

    const result = await generatePixelDiff(before, after, tmpDir, 'run-resize');

    // Resized to the larger 10x10 dimensions rather than throwing.
    expect(result.total_pixels).toBe(100);
  });
});

describe('resolveThreshold (FR-14)', () => {
  const originalEnv = process.env.DIFF_THRESHOLD;

  afterEach(() => {
    process.env.DIFF_THRESHOLD = originalEnv;
  });

  it('defaults to 0.1 when nothing is configured', () => {
    delete process.env.DIFF_THRESHOLD;
    expect(resolveThreshold()).toBe(0.1);
  });

  it('prefers an explicit value over the env default', () => {
    process.env.DIFF_THRESHOLD = '0.5';
    expect(resolveThreshold(0.2)).toBe(0.2);
  });

  it('falls back to the env value when no explicit value is given', () => {
    process.env.DIFF_THRESHOLD = '0.3';
    expect(resolveThreshold()).toBe(0.3);
  });

  it('ignores an out-of-range env value', () => {
    process.env.DIFF_THRESHOLD = '5';
    expect(resolveThreshold()).toBe(0.1);
  });
});

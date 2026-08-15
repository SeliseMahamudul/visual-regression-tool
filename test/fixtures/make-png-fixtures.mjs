// Regenerates test/fixtures/{before,after}.png deterministically.
// Run: node test/fixtures/make-png-fixtures.mjs
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function build(withBar) {
  const w = 120;
  const h = 80;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // White page with a navy header bar.
      let r = 248, g = 250, b = 252;
      if (y < 16) { r = 30; g = 41; b = 59; }
      // The deliberate regression: a violet call-to-action present only in "after".
      if (withBar && y >= 40 && y < 56 && x >= 20 && x < 90) { r = 124; g = 58; b = 237; }
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

writeFileSync(join(here, 'before.png'), build(false));
writeFileSync(join(here, 'after.png'), build(true));
console.log('wrote before.png + after.png');

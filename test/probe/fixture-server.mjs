/**
 * Minimal static file server for test/fixtures/{stage,dev}.
 *
 * TEST_PLAN §5.2 suggests `npx --yes http-server`, which needs network access
 * to fetch the package. This is the offline equivalent: no dependencies, same
 * behaviour, and it can be imported by live-probe.mjs so the probe is a single
 * self-contained command.
 *
 *   node test/probe/fixture-server.mjs ./test/fixtures/stage 8081
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export function startFixtureServer(rootDir, port) {
  const root = resolve(rootDir);

  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let filePath = resolve(join(root, normalize(urlPath)));
      // Refuse to serve outside the fixture root.
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) filePath = join(filePath, 'index.html');

      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream',
        // -c-1: never cache, so an edited fixture is picked up immediately.
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  return new Promise((res_, rej) => {
    server.once('error', rej);
    server.listen(port, '127.0.0.1', () => res_(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const [, , dir = './test/fixtures/stage', port = '8081'] = process.argv;
  await startFixtureServer(dir, Number(port));
  console.log(`fixture server: ${dir} -> http://127.0.0.1:${port}`);
}

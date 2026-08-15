import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { PNG } from 'pngjs';
import app from '../index';

function pngBuffer(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

const UPLOADS_DIR = process.env.UPLOADS_DIR as string;
const RESULTS_DIR = process.env.RESULTS_DIR as string;

afterAll(() => {
  for (const dir of [UPLOADS_DIR, RESULTS_DIR]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('POST /api/compare (§12.2)', () => {
  it('returns a classification for a valid before/after upload', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-happy-path')
      .field('page_name', 'Home Page')
      .attach('before', pngBuffer(10, 10, [255, 255, 255]), 'before.png')
      .attach('after', pngBuffer(10, 10, [255, 255, 255]), 'after.png');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.classification).toBeDefined();
    expect(res.body.result.before_screenshot).toBe('/api/screenshots/itest-happy-path/before');
  });

  it('returns 400 when the after screenshot is missing', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-missing-after')
      .attach('before', pngBuffer(10, 10, [255, 255, 255]), 'before.png');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/before and after/i);
  });

  it('returns 400 for a run_id containing unsafe characters', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', '../../etc/passwd')
      .attach('before', pngBuffer(5, 5, [0, 0, 0]), 'before.png')
      .attach('after', pngBuffer(5, 5, [0, 0, 0]), 'after.png');

    expect(res.status).toBe(400);
  });

  it('returns 500 with a clear error when the Gemini key is missing', async () => {
    const prevProvider = process.env.VISION_PROVIDER;
    const prevKey = process.env.GEMINI_API_KEY;
    process.env.VISION_PROVIDER = 'gemini';
    delete process.env.GEMINI_API_KEY;

    try {
      const res = await request(app)
        .post('/api/compare')
        .field('run_id', 'itest-no-key')
        .attach('before', pngBuffer(5, 5, [0, 0, 0]), 'before.png')
        .attach('after', pngBuffer(5, 5, [0, 0, 0]), 'after.png');

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/GEMINI_API_KEY/);
    } finally {
      process.env.VISION_PROVIDER = prevProvider;
      process.env.GEMINI_API_KEY = prevKey;
    }
  });

  it('serves the diff image after a successful comparison (FR-47)', async () => {
    await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-serve-diff')
      .attach('before', pngBuffer(8, 8, [255, 255, 255]), 'before.png')
      .attach('after', pngBuffer(8, 8, [0, 0, 0]), 'after.png');

    const res = await request(app).get('/api/screenshots/itest-serve-diff/diff');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });
});

describe('POST /api/compare with expectations (FR-60, FR-62)', () => {
  const rules = {
    expected: ['dark header'],
    unexpected: ['sidebar width change'],
    ignore: [],
    summary: 's',
    raw: 'r',
  };

  function storedResult(runId: string): Record<string, unknown> {
    const dir = path.join(RESULTS_DIR, runId);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.json')) as string;
    return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
  }

  it('persists a valid expectations payload with the result JSON (FR-60)', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-exp-valid')
      .field('page_name', 'Home Page')
      .attach('before', pngBuffer(10, 10, [255, 255, 255]), 'before.png')
      .attach('after', pngBuffer(10, 10, [255, 255, 255]), 'after.png')
      .field('expectations', JSON.stringify(rules));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.expectations).toEqual(rules);

    // FR-60: it must be on disk, not merely echoed back in the response.
    expect(storedResult('itest-exp-valid').expectations).toEqual(rules);
  });

  it('still succeeds when the expectations field is not JSON at all (FR-62)', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-exp-garbage')
      .attach('before', pngBuffer(10, 10, [255, 255, 255]), 'before.png')
      .attach('after', pngBuffer(10, 10, [0, 0, 0]), 'after.png')
      .field('expectations', 'not-json-at-all');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.classification).toBeDefined();
    expect(res.body.result.expectations).toBeUndefined();
  });

  it('still succeeds when expectations is valid JSON of the wrong shape (FR-62)', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-exp-wrong-shape')
      .attach('before', pngBuffer(10, 10, [255, 255, 255]), 'before.png')
      .attach('after', pngBuffer(10, 10, [0, 0, 0]), 'after.png')
      .field('expectations', JSON.stringify([1, 2, 3]));

    expect(res.status).toBe(200);
    expect(res.body.result.expectations).toBeUndefined();
  });

  it('normalises a hostile oversized payload rather than failing (FR-62, SEC-12)', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-exp-oversized')
      .attach('before', pngBuffer(10, 10, [255, 255, 255]), 'before.png')
      .attach('after', pngBuffer(10, 10, [0, 0, 0]), 'after.png')
      .field(
        'expectations',
        JSON.stringify({
          expected: Array.from({ length: 500 }, (_, i) => `c${i}`),
          unexpected: ['z'.repeat(10000)],
          ignore: 'not-an-array',
          summary: 's',
          raw: 'q'.repeat(10000),
        })
      );

    expect(res.status).toBe(200);
    const stored = storedResult('itest-exp-oversized') as {
      expectations: { expected: string[]; unexpected: string[]; ignore: string[]; raw: string };
    };
    expect(stored.expectations.expected).toHaveLength(20);
    expect(stored.expectations.unexpected[0]).toHaveLength(500);
    expect(stored.expectations.ignore).toEqual([]);
    expect(stored.expectations.raw).toHaveLength(4000);
  });

  it('omits the expectations key entirely when no field is sent (backwards compatibility)', async () => {
    const res = await request(app)
      .post('/api/compare')
      .field('run_id', 'itest-exp-absent')
      .field('page_name', 'Home Page')
      .attach('before', pngBuffer(10, 10, [255, 255, 255]), 'before.png')
      .attach('after', pngBuffer(10, 10, [255, 255, 255]), 'after.png');

    expect(res.status).toBe(200);
    // The response shape must be exactly what it was before this feature — an
    // absent key, not `expectations: null` or an empty shell.
    expect('expectations' in res.body.result).toBe(false);
    expect('expectations' in storedResult('itest-exp-absent')).toBe(false);
    expect(Object.keys(res.body.result).sort()).toEqual([
      'after_screenshot',
      'before_screenshot',
      'classification',
      'created_at',
      'diff_screenshot',
      'id',
      'page_name',
      'run_id',
    ]);
  });
});

describe('GET /api/integrations/status (§12.2)', () => {
  it('returns all integrations as false when nothing is configured', async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevJiraToken = process.env.JIRA_API_TOKEN;
    const prevGithub = process.env.GITHUB_TOKEN;
    delete process.env.GEMINI_API_KEY;
    delete process.env.JIRA_API_TOKEN;
    delete process.env.GITHUB_TOKEN;

    try {
      const res = await request(app).get('/api/integrations/status');
      expect(res.status).toBe(200);
      expect(res.body.integrations).toEqual({ gemini: false, jira: false, github: false });
    } finally {
      process.env.GEMINI_API_KEY = prevGemini;
      process.env.JIRA_API_TOKEN = prevJiraToken;
      process.env.GITHUB_TOKEN = prevGithub;
    }
  });
});

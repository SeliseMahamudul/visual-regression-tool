import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PNG } from 'pngjs';
import { parseClassificationResponse, classifyWithGemini } from './aiClassification';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, post: jest.fn() };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedPost = require('axios').post as jest.Mock;

// The Gemini provider reads image bytes off disk before it ever calls axios,
// so the request needs real (tiny) files even though the HTTP call is mocked.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-ai-'));
const tinyPng = path.join(tmpDir, 'tiny.png');
beforeAll(() => {
  const png = new PNG({ width: 1, height: 1 });
  fs.writeFileSync(tinyPng, PNG.sync.write(png));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseClassificationResponse', () => {
  it('parses a clean JSON response', () => {
    const result = parseClassificationResponse(
      JSON.stringify({
        classification: 'BUG',
        severity: 'critical',
        component: 'Nav Bar',
        explanation: 'Nav vanished',
        recommended_action: 'File a ticket',
        confidence: 95,
      })
    );
    expect(result.classification).toBe('BUG');
    expect(result.severity).toBe('critical');
    expect(result.confidence).toBe(95);
  });

  it('strips markdown code fences before parsing', () => {
    const result = parseClassificationResponse(
      '```json\n{"classification":"INTENTIONAL_CHANGE","severity":"low","component":"Button","explanation":"x","recommended_action":"y","confidence":80}\n```'
    );
    expect(result.classification).toBe('INTENTIONAL_CHANGE');
  });

  it('normalizes an out-of-contract classification to NEEDS_REVIEW (FR-16)', () => {
    const result = parseClassificationResponse(
      JSON.stringify({ classification: 'MAYBE_A_BUG', severity: 'high', component: 'X' })
    );
    expect(result.classification).toBe('NEEDS_REVIEW');
    expect(result.severity).toBe('none');
  });

  it('clamps confidence to the 0-100 range', () => {
    const result = parseClassificationResponse(
      JSON.stringify({ classification: 'BUG', severity: 'low', confidence: 150 })
    );
    expect(result.confidence).toBe(100);
  });

  it('throws a descriptive error for non-JSON responses', () => {
    expect(() => parseClassificationResponse('the model said something conversational')).toThrow(
      /non-JSON response/
    );
  });
});

describe('classifyWithGemini error handling (FR-21 / NFR-06)', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    process.env.VISION_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.AI_MAX_RETRIES = '0';
  });

  it('surfaces a clear message on 429 rate limiting', async () => {
    mockedPost.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 429',
      response: { status: 429, headers: {}, data: {} },
    });

    await expect(classifyWithGemini(tinyPng, tinyPng, tinyPng, 1.5)).rejects.toThrow(
      /rate limit/i
    );
  });

  it('surfaces a clear message on 404 (stale model name)', async () => {
    mockedPost.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 404',
      response: { status: 404, headers: {}, data: { error: { message: 'model not found' } } },
    });

    await expect(classifyWithGemini(tinyPng, tinyPng, tinyPng, 1.5)).rejects.toThrow(
      /GEMINI_MODEL/
    );
  });

  it('surfaces a clear message on invalid credentials', async () => {
    mockedPost.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 401',
      response: { status: 401, headers: {}, data: {} },
    });

    await expect(classifyWithGemini(tinyPng, tinyPng, tinyPng, 1.5)).rejects.toThrow(
      /GEMINI_API_KEY/
    );
  });

  it('does not throw when the mock provider is selected without an API key', async () => {
    process.env.VISION_PROVIDER = 'mock';
    delete process.env.GEMINI_API_KEY;

    const result = await classifyWithGemini(tinyPng, tinyPng, tinyPng, 0);
    expect(result.classification).toBe('DYNAMIC_CONTENT');
  });
});

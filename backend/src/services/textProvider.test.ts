import {
  getTextProvider,
  mockProvider,
  validateExpectationRules,
  MAX_RULES_PER_GROUP,
  MAX_RULE_LENGTH,
  MAX_RAW_LENGTH,
} from './textProvider';
import { EXTRACTION_SYSTEM_PROMPT } from './chatPrompt';

async function extract(text: string): Promise<{
  expected: string[];
  unexpected: string[];
  ignore: string[];
  summary: string;
  reply: string;
}> {
  const raw = await mockProvider({
    messages: [{ role: 'user', content: text }],
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
  });
  return JSON.parse(raw);
}

describe('getTextProvider (FR-58, FR-59)', () => {
  const prev = process.env.CHAT_PROVIDER;
  afterEach(() => {
    if (prev === undefined) delete process.env.CHAT_PROVIDER;
    else process.env.CHAT_PROVIDER = prev;
  });

  it('defaults to the offline mock provider when CHAT_PROVIDER is unset (FR-59)', () => {
    delete process.env.CHAT_PROVIDER;
    // Deliberately different from getProvider() in visionProvider.ts, which
    // defaults to gemini: chat is additive and must not throw on a fresh clone.
    expect(getTextProvider()).toBe(mockProvider);
  });

  it('resolves groq and ollama by name (FR-57, FR-58)', () => {
    process.env.CHAT_PROVIDER = 'groq';
    expect(typeof getTextProvider()).toBe('function');
    process.env.CHAT_PROVIDER = 'ollama';
    expect(typeof getTextProvider()).toBe('function');
  });

  it('is case-insensitive', () => {
    process.env.CHAT_PROVIDER = 'MOCK';
    expect(getTextProvider()).toBe(mockProvider);
  });

  it('throws naming the valid options for an unknown provider (NFR-09)', () => {
    process.env.CHAT_PROVIDER = 'chatgpt-5';
    expect(() => getTextProvider()).toThrow(/groq, ollama, mock/);
  });
});

describe('mockProvider extraction heuristic (FR-53, FR-59)', () => {
  it('classifies a "must not change" clause as unexpected', async () => {
    const out = await extract('The sidebar width must not change');
    expect(out.unexpected).toEqual(['The sidebar width must not change']);
    expect(out.expected).toEqual([]);
  });

  it('classifies "should not" and "never" clauses as unexpected', async () => {
    const out = await extract('The logo should not move. The nav must never disappear');
    expect(out.unexpected).toHaveLength(2);
  });

  it('classifies an "ignore timestamps" clause as ignore', async () => {
    const out = await extract('Ignore the footer timestamp');
    expect(out.ignore).toEqual(['Ignore the footer timestamp']);
  });

  it('classifies dynamic-content vocabulary as ignore', async () => {
    const out = await extract('The user avatar is random. The counter changes every second');
    expect(out.ignore).toHaveLength(2);
  });

  it('classifies a plain statement of intent as expected', async () => {
    const out = await extract('We intentionally made the header dark');
    expect(out.expected).toEqual(['We intentionally made the header dark']);
  });

  it('splits a multi-clause instruction across all three groups', async () => {
    const out = await extract(
      'We moved the search bar into the header. The sidebar width must not change. Ignore the timestamp'
    );
    expect(out.expected).toEqual(['We moved the search bar into the header']);
    expect(out.unexpected).toEqual(['The sidebar width must not change']);
    expect(out.ignore).toEqual(['Ignore the timestamp']);
  });

  it('does not mistake "another" or "notice" for the "not" marker', async () => {
    const out = await extract('We added another notice banner');
    expect(out.expected).toEqual(['We added another notice banner']);
    expect(out.unexpected).toEqual([]);
  });

  it('self-identifies as offline so it cannot pass for a real model (FR-59)', async () => {
    const out = await extract('We made the header dark');
    expect(out.summary).toMatch(/no chat model was called/i);
    expect(out.summary).toMatch(/CHAT_PROVIDER=groq/);
  });

  it('only reads user messages, never assistant turns', async () => {
    const raw = await mockProvider({
      messages: [
        { role: 'user', content: 'We made the header dark' },
        { role: 'assistant', content: 'The sidebar must not change' },
      ],
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    });
    const out = JSON.parse(raw);
    expect(out.expected).toEqual(['We made the header dark']);
    expect(out.unexpected).toEqual([]);
  });

  it('returns empty groups for an empty description', async () => {
    const out = await extract('   ');
    expect(out).toMatchObject({ expected: [], unexpected: [], ignore: [] });
  });
});

describe('validateExpectationRules (FR-62, SEC-12)', () => {
  it('never throws on null', () => {
    expect(validateExpectationRules(null)).toBeUndefined();
  });

  it('never throws on an array', () => {
    expect(validateExpectationRules([])).toBeUndefined();
  });

  it('never throws on a primitive', () => {
    expect(validateExpectationRules('not-json-at-all')).toBeUndefined();
    expect(validateExpectationRules(42)).toBeUndefined();
    expect(validateExpectationRules(undefined)).toBeUndefined();
  });

  it('coerces a string where an array was expected into an empty group', () => {
    const out = validateExpectationRules({ expected: 'a dark header', raw: 'r' });
    expect(out?.expected).toEqual([]);
    expect(out?.raw).toBe('r');
  });

  it('caps each group at 20 items (SEC-12)', () => {
    const out = validateExpectationRules({
      expected: Array.from({ length: 500 }, (_, i) => `c${i}`),
      raw: 'r',
    });
    expect(out?.expected).toHaveLength(MAX_RULES_PER_GROUP);
    expect(out?.expected[19]).toBe('c19');
  });

  it('caps each entry at 500 chars (SEC-12)', () => {
    const out = validateExpectationRules({
      unexpected: ['z'.repeat(10000)],
      raw: 'r',
    });
    expect(out?.unexpected[0]).toHaveLength(MAX_RULE_LENGTH);
  });

  it('caps raw at 4000 chars (SEC-12)', () => {
    const out = validateExpectationRules({ raw: 'q'.repeat(10000) });
    expect(out?.raw).toHaveLength(MAX_RAW_LENGTH);
  });

  it('drops empty and whitespace-only entries', () => {
    const out = validateExpectationRules({
      expected: ['  ', '', 'a real rule', '   '],
      raw: 'r',
    });
    expect(out?.expected).toEqual(['a real rule']);
  });

  it('stringifies non-string array members rather than failing', () => {
    const out = validateExpectationRules({ ignore: [1, true, null], raw: 'r' });
    // null collapses to '' and is filtered out; the rest survive as strings.
    expect(out?.ignore).toEqual(['1', 'true']);
  });

  it('returns undefined for an object carrying nothing usable', () => {
    expect(validateExpectationRules({})).toBeUndefined();
    expect(validateExpectationRules({ summary: 'just a summary' })).toBeUndefined();
  });

  it('returns a fully normalised object for well-formed input', () => {
    expect(
      validateExpectationRules({
        expected: ['dark header'],
        unexpected: ['sidebar width change'],
        ignore: ['timestamp'],
        summary: 's',
        raw: 'r',
      })
    ).toEqual({
      expected: ['dark header'],
      unexpected: ['sidebar width change'],
      ignore: ['timestamp'],
      summary: 's',
      raw: 'r',
    });
  });

  it('always returns exactly the five contract keys, no extras', () => {
    const out = validateExpectationRules({
      expected: ['a'],
      raw: 'r',
      // A hostile payload trying to smuggle extra fields into the result JSON.
      __proto__hack: 'x',
      classification: 'INTENTIONAL_CHANGE',
    });
    expect(Object.keys(out ?? {}).sort()).toEqual([
      'expected',
      'ignore',
      'raw',
      'summary',
      'unexpected',
    ]);
  });
});

import { extractJsonObject } from './jsonFromModel';

/**
 * This helper was extracted verbatim out of parseClassificationResponse so the
 * chat route can share it. These tests assert it still behaves exactly as the
 * code it replaced.
 */
describe('extractJsonObject', () => {
  it('parses a clean JSON object', () => {
    expect(extractJsonObject('{"a":1,"b":"two"}')).toEqual({ a: 1, b: 'two' });
  });

  it('strips ```json markdown fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips bare ``` fences', () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers the outermost {...} span from a conversational preamble', () => {
    expect(
      extractJsonObject('Sure! Here is the JSON you asked for: {"a":1} — hope that helps.')
    ).toEqual({ a: 1 });
  });

  it('handles nested objects when falling back to the {...} span', () => {
    expect(
      extractJsonObject('preamble {"a":{"b":[1,2]},"c":3} trailing words')
    ).toEqual({ a: { b: [1, 2] }, c: 3 });
  });

  it('throws a descriptive error for garbage with no JSON at all (NFR-09)', () => {
    expect(() => extractJsonObject('the model said something conversational')).toThrow(
      /non-JSON response/
    );
  });

  it('throws a descriptive error for an empty string', () => {
    expect(() => extractJsonObject('')).toThrow(/\(empty\)/);
  });

  it('does not throw on a null/undefined input, it reports it as non-JSON', () => {
    // The provider layer can hand back undefined when a response shape changes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately
    // exercising the untyped path a misbehaving provider would take.
    expect(() => extractJsonObject(undefined as any)).toThrow(/non-JSON response/);
  });
});

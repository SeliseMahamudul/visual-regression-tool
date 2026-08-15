import { buildClassificationPrompt, CLASSIFICATION_PROMPT, contextLine } from './visionPrompt';
import { ExpectationRules } from '../types';

/**
 * The prompt had no test coverage at all before the chatbot feature, so it
 * could be broken silently. These lock down both the refactor (FR-55) and the
 * safety property that makes the feature shippable (FR-56).
 */

const rules: ExpectationRules = {
  expected: ['the header is now dark', 'the search bar moved into the header'],
  unexpected: ['the sidebar width changed'],
  ignore: ['the timestamp in the footer'],
  summary: '2 expected, 1 unexpected, 1 ignored',
  raw: 'We intentionally made the header dark and moved search into it. The sidebar width must not change. Ignore the footer timestamp.',
};

describe('buildClassificationPrompt', () => {
  it('with no arguments is byte-identical to the exported CLASSIFICATION_PROMPT', () => {
    // Proves the const-to-builder refactor changed nothing for existing runs.
    expect(buildClassificationPrompt()).toBe(CLASSIFICATION_PROMPT);
  });

  it('with no arguments contains no expectations section', () => {
    const prompt = buildClassificationPrompt();
    expect(prompt).not.toMatch(/QA engineer has told us/);
    expect(prompt).not.toMatch(/In their own words/);
  });

  it('reads VR_PROJECT_CONTEXT at call time, not module load (CLAUDE.md gotcha #1)', () => {
    // The env var is set AFTER this module was imported. A module-scope read
    // — the bug this refactor fixes — could never see it.
    const prev = process.env.VR_PROJECT_CONTEXT;
    process.env.VR_PROJECT_CONTEXT = 'We use the Acme design system.';
    try {
      expect(buildClassificationPrompt()).toContain('We use the Acme design system.');
    } finally {
      if (prev === undefined) delete process.env.VR_PROJECT_CONTEXT;
      else process.env.VR_PROJECT_CONTEXT = prev;
    }
  });

  it('layers expectations on top of VR_PROJECT_CONTEXT rather than replacing it (FR-55)', () => {
    const prev = process.env.VR_PROJECT_CONTEXT;
    process.env.VR_PROJECT_CONTEXT = 'Acme design system.';
    try {
      const prompt = buildClassificationPrompt(rules);
      expect(prompt).toContain('Acme design system.');
      expect(prompt).toContain('the header is now dark');
      // Per-run rules are stated last, where they carry the most weight.
      expect(prompt.indexOf('Acme design system.')).toBeLessThan(
        prompt.indexOf('the header is now dark')
      );
    } finally {
      if (prev === undefined) delete process.env.VR_PROJECT_CONTEXT;
      else process.env.VR_PROJECT_CONTEXT = prev;
    }
  });

  it('includes the raw user text verbatim, delimited (FR-55, SEC-12)', () => {
    const prompt = buildClassificationPrompt(rules);
    expect(prompt).toContain(rules.raw);
    expect(prompt).toContain('"""');
  });

  it('includes all three rule groups under their own headings (FR-55)', () => {
    const prompt = buildClassificationPrompt(rules);
    expect(prompt).toContain('They said these changes are INTENTIONAL:');
    expect(prompt).toContain('- the header is now dark');
    expect(prompt).toContain('They said these changes must NOT happen');
    expect(prompt).toContain('- the sidebar width changed');
    expect(prompt).toContain('They said these regions are dynamic');
    expect(prompt).toContain('- the timestamp in the footer');
  });

  it('instructs the model to still report every change, including expected ones (FR-56)', () => {
    // THE safety property. Without this instruction the feature becomes a way
    // to silence the tool — strictly worse than not having it.
    const prompt = buildClassificationPrompt(rules);
    expect(prompt).toContain('still report and explain every change you see');
    expect(prompt).toContain('never to hide it');
  });

  it('instructs the model to override the user when the pixels disagree (FR-56, SEC-13)', () => {
    const prompt = buildClassificationPrompt(rules);
    expect(prompt).toContain('trust your own eyes');
    expect(prompt).toMatch(/lower your confidence/);
  });

  it('emits no empty headings when a rule group is empty', () => {
    const prompt = buildClassificationPrompt({
      expected: ['a redesigned footer'],
      unexpected: [],
      ignore: [],
      summary: 's',
      raw: 'we redesigned the footer',
    });
    expect(prompt).toContain('They said these changes are INTENTIONAL:');
    expect(prompt).not.toContain('must NOT happen');
    expect(prompt).not.toContain('regions are dynamic');
  });

  it('produces no expectations section for an all-empty rules object', () => {
    const prompt = buildClassificationPrompt({
      expected: [],
      unexpected: [],
      ignore: [],
      summary: '',
      raw: '',
    });
    expect(prompt).toBe(buildClassificationPrompt());
  });

  it('caps rule groups at 20 items and each entry at 500 chars (SEC-12)', () => {
    const prompt = buildClassificationPrompt({
      expected: Array.from({ length: 50 }, (_, i) => `change-${i}`),
      unexpected: ['x'.repeat(2000)],
      ignore: [],
      summary: '',
      raw: 'r',
    });
    expect(prompt).toContain('- change-19');
    expect(prompt).not.toContain('- change-20');
    expect(prompt).not.toContain('x'.repeat(501));
    expect(prompt).toContain('x'.repeat(500));
  });

  it('caps the raw text at 4000 chars (SEC-12)', () => {
    const prompt = buildClassificationPrompt({
      expected: [],
      unexpected: [],
      ignore: [],
      summary: '',
      raw: 'y'.repeat(9000),
    });
    expect(prompt).not.toContain('y'.repeat(4001));
    expect(prompt).toContain('y'.repeat(4000));
  });
});

describe('contextLine', () => {
  it('reports the diff percentage to two decimal places', () => {
    expect(contextLine(3.14159)).toContain('3.14%');
  });
});

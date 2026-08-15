import { severityToLabel } from './githubService';

describe('severityToLabel (FR-32)', () => {
  it('always includes the base labels', () => {
    const labels = severityToLabel('critical');
    expect(labels).toEqual(expect.arrayContaining(['visual-regression', 'automated-qa']));
  });

  it('appends the correct priority label for critical', () => {
    expect(severityToLabel('critical')).toContain('priority: critical');
  });

  it('appends the correct priority label for medium', () => {
    expect(severityToLabel('medium')).toContain('priority: medium');
  });

  it('appends the correct priority label for low', () => {
    expect(severityToLabel('low')).toContain('priority: low');
  });

  it('omits a priority label for severities with no mapping', () => {
    const labels = severityToLabel('none');
    expect(labels).toEqual(['visual-regression', 'automated-qa']);
  });
});

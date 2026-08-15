import { severityToPriority, jiraIssueUrl } from './jiraService';

describe('severityToPriority (FR-26)', () => {
  it('maps critical to Highest', () => {
    expect(severityToPriority('critical')).toBe('Highest');
  });

  it('maps medium to Medium', () => {
    expect(severityToPriority('medium')).toBe('Medium');
  });

  it('maps low to Low', () => {
    expect(severityToPriority('low')).toBe('Low');
  });

  it('falls back to Medium for an unrecognized severity', () => {
    expect(severityToPriority('unknown')).toBe('Medium');
  });
});

describe('jiraIssueUrl (FR-41)', () => {
  const originalBaseUrl = process.env.JIRA_BASE_URL;

  afterEach(() => {
    process.env.JIRA_BASE_URL = originalBaseUrl;
  });

  it('builds a browse URL when JIRA_BASE_URL is configured', () => {
    process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
    expect(jiraIssueUrl('QA-247')).toBe('https://example.atlassian.net/browse/QA-247');
  });

  it('strips a trailing slash from the base URL', () => {
    process.env.JIRA_BASE_URL = 'https://example.atlassian.net/';
    expect(jiraIssueUrl('QA-247')).toBe('https://example.atlassian.net/browse/QA-247');
  });

  it('returns undefined when Jira is not configured', () => {
    delete process.env.JIRA_BASE_URL;
    expect(jiraIssueUrl('QA-247')).toBeUndefined();
  });
});

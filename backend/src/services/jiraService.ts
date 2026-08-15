import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';
import { AIClassification, JiraIssue } from '../types';

// Env is read at call time, not module load time — module bodies evaluate
// before dotenv has populated process.env.
function jiraConfig() {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      'Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.'
    );
  }

  return {
    baseUrl,
    authHeader: Buffer.from(`${email}:${apiToken}`).toString('base64'),
  };
}

function jiraClient() {
  const { baseUrl, authHeader } = jiraConfig();
  return axios.create({
    baseURL: baseUrl,
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

// Exported for jiraService.test.ts (REQUIREMENTS §12.1).
export function severityToPriority(severity: string): string {
  const map: Record<string, string> = {
    critical: 'Highest',
    medium: 'Medium',
    low: 'Low',
    none: 'Low',
  };
  return map[severity] || 'Medium';
}

function buildIssueDescription(
  pageName: string,
  classification: AIClassification,
  diffPercentage: number,
  runId: string
): string {
  return `
h2. Visual Regression Bug Detected

*Page:* ${pageName}
*Run ID:* ${runId}
*Detected At:* ${new Date().toISOString()}

h3. AI Analysis
*Classification:* ${classification.classification}
*Severity:* ${classification.severity}
*Component:* ${classification.component}
*Confidence:* ${classification.confidence}%
*Pixels Changed:* ${diffPercentage.toFixed(2)}%

h3. Explanation
${classification.explanation}

h3. Recommended Action
${classification.recommended_action}

h3. Screenshots
Screenshots are attached to this ticket (before, after, and diff images).

_This issue was automatically filed by Visual Regression AI Tool._
  `.trim();
}

export async function createJiraIssue(
  projectKey: string,
  pageName: string,
  classification: AIClassification,
  runId: string,
  diffPath: string,
  beforePath: string,
  afterPath: string
): Promise<string> {
  const issueData: JiraIssue = {
    project_key: projectKey,
    summary: `[Visual Regression] ${classification.severity.toUpperCase()} - ${classification.component} changed on "${pageName}"`,
    description: buildIssueDescription(pageName, classification, classification.diff_percentage, runId),
    issue_type: 'Bug',
    priority: severityToPriority(classification.severity),
    labels: ['visual-regression', 'automated', `severity-${classification.severity}`],
  };

  // Create the Jira issue
  const response = await jiraClient().post('/rest/api/3/issue', {
    fields: {
      project: { key: issueData.project_key },
      summary: issueData.summary,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: issueData.description }],
          },
        ],
      },
      issuetype: { name: issueData.issue_type },
      priority: { name: issueData.priority },
      labels: issueData.labels,
    },
  });

  const issueKey = response.data.key;

  // Attach screenshots
  await attachFilesToJira(issueKey, [
    { path: beforePath, name: 'before.png' },
    { path: afterPath, name: 'after.png' },
    { path: diffPath, name: 'diff.png' },
  ]);

  return issueKey;
}

// FR-41: the backend knows JIRA_BASE_URL; the frontend doesn't, so ResultCard
// can't construct a working ticket link without this.
export function jiraIssueUrl(issueKey: string): string | undefined {
  const baseUrl = process.env.JIRA_BASE_URL;
  return baseUrl ? `${baseUrl.replace(/\/$/, '')}/browse/${issueKey}` : undefined;
}

async function attachFilesToJira(
  issueKey: string,
  files: { path: string; name: string }[]
): Promise<void> {
  const { baseUrl, authHeader } = jiraConfig();

  for (const file of files) {
    const form = new FormData();
    form.append('file', fs.createReadStream(file.path), file.name);

    await axios.post(
      `${baseUrl}/rest/api/3/issue/${issueKey}/attachments`,
      form,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          'X-Atlassian-Token': 'no-check',
          ...form.getHeaders(),
        },
      }
    );
  }
}

export async function testJiraConnection(): Promise<boolean> {
  try {
    await jiraClient().get('/rest/api/3/myself');
    return true;
  } catch {
    return false;
  }
}

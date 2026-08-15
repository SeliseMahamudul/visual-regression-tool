import axios from 'axios';
import { AIClassification } from '../types';

// Read at call time, not module load time — module bodies evaluate before
// dotenv has populated process.env.
function githubClient() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is not set. Add it to backend/.env');
  }

  return axios.create({
    baseURL: 'https://api.github.com',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

function severityToLabel(severity: string): string[] {
  const base = ['visual-regression', 'automated-qa'];
  const severityLabels: Record<string, string> = {
    critical: 'priority: critical',
    medium: 'priority: medium',
    low: 'priority: low',
  };
  if (severityLabels[severity]) base.push(severityLabels[severity]);
  return base;
}

function buildIssueBody(
  pageName: string,
  classification: AIClassification,
  runId: string,
  prNumber?: string
): string {
  const prLink = prNumber ? `\n**Pull Request:** #${prNumber}` : '';
  return `
## 🔍 Visual Regression Detected

| Field | Value |
|-------|-------|
| **Page** | ${pageName} |
| **Component** | ${classification.component} |
| **Classification** | \`${classification.classification}\` |
| **Severity** | \`${classification.severity.toUpperCase()}\` |
| **Confidence** | ${classification.confidence}% |
| **Pixels Changed** | ${classification.diff_percentage.toFixed(2)}% |
| **Run ID** | \`${runId}\` |${prLink}

## 📝 AI Explanation

${classification.explanation}

## ✅ Recommended Action

${classification.recommended_action}

## 📸 Screenshots

> Screenshots are stored in the CI artifacts for run \`${runId}\`. Download them from the Actions run to view before/after/diff images.

---
*🤖 This issue was automatically filed by [Visual Regression AI Tool](https://github.com/your-org/visual-regression-ai)*
  `.trim();
}

export async function createGitHubIssue(
  owner: string,
  repo: string,
  pageName: string,
  classification: AIClassification,
  runId: string,
  prNumber?: string
): Promise<string> {
  const title = `[Visual Regression] ${classification.severity.toUpperCase()}: ${classification.component} on "${pageName}"`;
  const body = buildIssueBody(pageName, classification, runId, prNumber);
  const labels = severityToLabel(classification.severity);

  // Ensure labels exist before filing
  await ensureLabelsExist(owner, repo, labels);

  const response = await githubClient().post(`/repos/${owner}/${repo}/issues`, {
    title,
    body,
    labels,
  });

  return response.data.html_url;
}

export async function commentOnPR(
  owner: string,
  repo: string,
  prNumber: number,
  results: Array<{
    pageName: string;
    classification: AIClassification;
    issueUrl?: string;
  }>
): Promise<void> {
  const bugs = results.filter(
    (r) =>
      r.classification.classification === 'BUG' ||
      r.classification.classification === 'NEEDS_REVIEW'
  );

  const passed = results.filter(
    (r) =>
      r.classification.classification === 'INTENTIONAL_CHANGE' ||
      r.classification.classification === 'DYNAMIC_CONTENT'
  );

  const statusEmoji = bugs.length === 0 ? '✅' : bugs.some(b => b.classification.severity === 'critical') ? '🔴' : '🟡';

  let comment = `## ${statusEmoji} Visual Regression Report\n\n`;
  comment += `| Metric | Value |\n|--------|-------|\n`;
  comment += `| Total Pages Tested | ${results.length} |\n`;
  comment += `| Bugs / Needs Review | ${bugs.length} |\n`;
  comment += `| Clean / Intentional | ${passed.length} |\n\n`;

  if (bugs.length > 0) {
    comment += `### 🐛 Issues Found\n\n`;
    comment += `| Page | Component | Severity | Classification | Issue |\n`;
    comment += `|------|-----------|----------|---------------|-------|\n`;
    for (const bug of bugs) {
      const issueLink = bug.issueUrl ? `[#link](${bug.issueUrl})` : 'N/A';
      comment += `| ${bug.pageName} | ${bug.classification.component} | \`${bug.classification.severity}\` | \`${bug.classification.classification}\` | ${issueLink} |\n`;
    }
    comment += '\n';
  }

  if (passed.length > 0) {
    comment += `### ✅ Clean Pages\n\n`;
    comment += passed.map(p => `- **${p.pageName}**: ${p.classification.explanation}`).join('\n');
  }

  comment += `\n\n---\n*🤖 Automated by Visual Regression AI Tool*`;

  await githubClient().post(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    { body: comment }
  );
}

async function ensureLabelsExist(
  owner: string,
  repo: string,
  labels: string[]
): Promise<void> {
  const labelConfigs: Record<string, { color: string; description: string }> = {
    'visual-regression': { color: 'e11d48', description: 'Visual regression detected' },
    'automated-qa': { color: '7c3aed', description: 'Filed by automated QA system' },
    'priority: critical': { color: 'dc2626', description: 'Critical priority issue' },
    'priority: medium': { color: 'f59e0b', description: 'Medium priority issue' },
    'priority: low': { color: '84cc16', description: 'Low priority issue' },
  };

  const client = githubClient();

  for (const label of labels) {
    try {
      await client.get(`/repos/${owner}/${repo}/labels/${encodeURIComponent(label)}`);
    } catch {
      // Label doesn't exist, create it
      const config = labelConfigs[label] || { color: '6b7280', description: label };
      await client.post(`/repos/${owner}/${repo}/labels`, {
        name: label,
        color: config.color,
        description: config.description,
      }).catch(() => {}); // Ignore if already exists (race condition)
    }
  }
}

export async function testGitHubConnection(owner: string, repo: string): Promise<boolean> {
  try {
    await githubClient().get(`/repos/${owner}/${repo}`);
    return true;
  } catch {
    return false;
  }
}

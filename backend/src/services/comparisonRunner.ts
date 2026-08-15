import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { generatePixelDiff, DiffResult } from './pixelDiff';
import { classifyWithGemini } from './aiClassification';
import { createJiraIssue, jiraIssueUrl } from './jiraService';
import { createGitHubIssue } from './githubService';
import { TestResult } from '../types';

/**
 * The comparison pipeline, extracted verbatim from routes/compare.ts so that
 * both the multipart HTTP route and live mode (backend/src/live) run exactly
 * the same code. Behaviour-preserving refactor — see WEB_APP_REGRESSION_PLAN
 * §3.6.
 */

export type ComparisonStage = 'diffing' | 'classifying' | 'filing';

export interface ComparisonOptions {
  runId: string;
  pageName: string;
  autoFileBugs: boolean;
  jiraProjectKey?: string;
  githubOwner?: string;
  githubRepo?: string;
  prNumber?: string;
  onProgress?: (stage: ComparisonStage) => void;
}

export interface ComparisonOutcome {
  result: TestResult;
  diff: DiffResult;
}

/** Read at call time, never at module load (CLAUDE.md gotcha #1). */
function resultsDir(): string {
  return process.env.RESULTS_DIR || path.join(process.cwd(), 'results');
}

/**
 * The whole pipeline, minus transport. Assumes both files are already on disk
 * under uploads/{runId}/ and that runId has passed SAFE_RUN_ID.
 */
export async function runComparison(
  beforePath: string,
  afterPath: string,
  opts: ComparisonOptions
): Promise<ComparisonOutcome> {
  const { runId, pageName } = opts;

  // REQUIREMENTS §10.1: results/{run_id}/
  const resultDir = path.join(resultsDir(), runId);
  if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

  // Step 1: Generate pixel diff
  opts.onProgress?.('diffing');
  console.log(`[${runId}] Generating pixel diff...`);
  const diffResult = await generatePixelDiff(beforePath, afterPath, resultDir, runId);

  // Step 2: AI Classification
  opts.onProgress?.('classifying');
  console.log(`[${runId}] Running AI classification...`);
  const classification = await classifyWithGemini(
    beforePath,
    afterPath,
    diffResult.diff_path,
    diffResult.diff_percentage
  );

  const result: TestResult = {
    id: uuidv4(),
    run_id: runId,
    page_name: pageName,
    before_screenshot: beforePath,
    after_screenshot: afterPath,
    diff_screenshot: diffResult.diff_path,
    classification,
    created_at: new Date().toISOString(),
  };

  // Step 3: Auto-file bugs if enabled
  const shouldFileBug =
    opts.autoFileBugs &&
    (classification.classification === 'BUG' ||
      (classification.classification === 'NEEDS_REVIEW' &&
        classification.severity === 'critical'));

  if (shouldFileBug) {
    opts.onProgress?.('filing');

    // FR-28/FR-35: integrations are always optional — catch, log, continue.
    if (opts.jiraProjectKey && process.env.JIRA_API_TOKEN) {
      try {
        console.log(`[${runId}] Filing Jira issue...`);
        const jiraKey = await createJiraIssue(
          opts.jiraProjectKey,
          pageName,
          classification,
          runId,
          diffResult.diff_path,
          beforePath,
          afterPath
        );
        result.jira_ticket = jiraKey;
        result.jira_url = jiraIssueUrl(jiraKey);
        console.log(`[${runId}] Jira issue created: ${jiraKey}`);
      } catch (err) {
        console.error(`[${runId}] Jira error:`, err);
      }
    }

    if (opts.githubOwner && opts.githubRepo && process.env.GITHUB_TOKEN) {
      try {
        console.log(`[${runId}] Filing GitHub issue...`);
        const issueUrl = await createGitHubIssue(
          opts.githubOwner,
          opts.githubRepo,
          pageName,
          classification,
          runId,
          opts.prNumber
        );
        result.github_issue = issueUrl;
        console.log(`[${runId}] GitHub issue created: ${issueUrl}`);
      } catch (err) {
        console.error(`[${runId}] GitHub error:`, err);
      }
    }
  }

  // Save result to disk (REQUIREMENTS §10.1: results/{run_id}/{id}.json)
  const resultFile = path.join(resultDir, `${result.id}.json`);
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));

  return { result, diff: diffResult };
}

/**
 * FR-69: live results must carry the same URL shape the dashboard already
 * renders, so the existing ResultCard/ScreenshotViewer work unmodified.
 * Rewrites exactly the three screenshot fields and nothing else.
 */
export function toApiUrls(result: TestResult): TestResult {
  return {
    ...result,
    before_screenshot: `/api/screenshots/${result.run_id}/before`,
    after_screenshot: `/api/screenshots/${result.run_id}/after`,
    diff_screenshot: `/api/screenshots/${result.run_id}/diff`,
  };
}

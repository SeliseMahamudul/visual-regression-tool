import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { runComparison, toApiUrls, ComparisonStage } from './comparisonRunner';
import { TestResult } from '../types';

const UPLOADS_DIR = process.env.UPLOADS_DIR as string;
const RESULTS_DIR = process.env.RESULTS_DIR as string;

function writePng(
  filePath: string,
  width: number,
  height: number,
  rgb: [number, number, number]
): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

/** Lays the two inputs out exactly as the live/upload paths do: uploads/{runId}/ */
function stageInputs(runId: string): { beforePath: string; afterPath: string } {
  const dir = path.join(UPLOADS_DIR, runId);
  const beforePath = path.join(dir, `before_${Date.now()}.png`);
  const afterPath = path.join(dir, `after_${Date.now()}.png`);
  writePng(beforePath, 12, 12, [255, 255, 255]);
  writePng(afterPath, 12, 12, [0, 0, 0]);
  return { beforePath, afterPath };
}

afterAll(() => {
  for (const dir of [UPLOADS_DIR, RESULTS_DIR]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('runComparison (FR-50, REQUIREMENTS §10.1)', () => {
  it('writes the §10.1 on-disk layout: results/{runId}/{id}.json and {runId}_diff.png', async () => {
    const runId = 'unit-runner-layout';
    const { beforePath, afterPath } = stageInputs(runId);

    const { result, diff } = await runComparison(beforePath, afterPath, {
      runId,
      pageName: 'Layout Page',
      autoFileBugs: false,
    });

    const resultDir = path.join(RESULTS_DIR, runId);
    expect(fs.existsSync(path.join(resultDir, `${runId}_diff.png`))).toBe(true);
    expect(fs.existsSync(path.join(resultDir, `${result.id}.json`))).toBe(true);
    expect(diff.diff_path).toBe(path.join(resultDir, `${runId}_diff.png`));

    // The uploads live where the screenshots route looks for them.
    const uploadDir = path.join(UPLOADS_DIR, runId);
    expect(fs.readdirSync(uploadDir).some((f) => f.startsWith('before_'))).toBe(true);
    expect(fs.readdirSync(uploadDir).some((f) => f.startsWith('after_'))).toBe(true);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(resultDir, `${result.id}.json`), 'utf-8')
    ) as TestResult;
    expect(persisted.run_id).toBe(runId);
    expect(persisted.page_name).toBe('Layout Page');
    // The persisted record keeps absolute disk paths; only the API response is rewritten.
    expect(persisted.before_screenshot).toBe(beforePath);
  });

  it('fires onProgress in the order diffing -> classifying (live progress UI)', async () => {
    const runId = 'unit-runner-progress';
    const { beforePath, afterPath } = stageInputs(runId);
    const stages: ComparisonStage[] = [];

    await runComparison(beforePath, afterPath, {
      runId,
      pageName: 'Progress Page',
      autoFileBugs: false,
      onProgress: (s) => stages.push(s),
    });

    expect(stages).toEqual(['diffing', 'classifying']);
  });

  it('does not emit the filing stage or touch integrations when autoFileBugs is false (FR-28/FR-35)', async () => {
    const runId = 'unit-runner-nofiling';
    const { beforePath, afterPath } = stageInputs(runId);
    const stages: ComparisonStage[] = [];

    const { result } = await runComparison(beforePath, afterPath, {
      runId,
      pageName: 'No Filing',
      autoFileBugs: false,
      jiraProjectKey: 'VR',
      githubOwner: 'o',
      githubRepo: 'r',
      onProgress: (s) => stages.push(s),
    });

    expect(stages).not.toContain('filing');
    expect(result.jira_ticket).toBeUndefined();
    expect(result.github_issue).toBeUndefined();
  });

  it('reports a non-zero diff percentage for visibly different images (FR-13)', async () => {
    const runId = 'unit-runner-diffpct';
    const { beforePath, afterPath } = stageInputs(runId);

    const { result } = await runComparison(beforePath, afterPath, {
      runId,
      pageName: 'Diff Page',
      autoFileBugs: false,
    });

    expect(result.classification.diff_percentage).toBeGreaterThan(0);
  });
});

describe('toApiUrls (FR-69)', () => {
  const base: TestResult = {
    id: 'abc-123',
    run_id: 'live-xyz-c1',
    page_name: 'Checkout',
    before_screenshot: 'C:/somewhere/uploads/live-xyz-c1/before_1.png',
    after_screenshot: 'C:/somewhere/uploads/live-xyz-c1/after_1.png',
    diff_screenshot: 'C:/somewhere/results/live-xyz-c1/live-xyz-c1_diff.png',
    classification: {
      classification: 'BUG',
      severity: 'critical',
      component: 'Nav',
      explanation: 'e',
      recommended_action: 'a',
      confidence: 90,
      diff_percentage: 12.5,
    },
    jira_ticket: 'VR-1',
    jira_url: 'https://example.atlassian.net/browse/VR-1',
    github_issue: 'https://github.com/o/r/issues/1',
    created_at: '2026-08-15T00:00:00.000Z',
  };

  it('rewrites exactly the three screenshot fields', () => {
    const out = toApiUrls(base);
    expect(out.before_screenshot).toBe('/api/screenshots/live-xyz-c1/before');
    expect(out.after_screenshot).toBe('/api/screenshots/live-xyz-c1/after');
    expect(out.diff_screenshot).toBe('/api/screenshots/live-xyz-c1/diff');
  });

  it('touches nothing else on the result', () => {
    const out = toApiUrls(base);
    const strip = (r: TestResult) => {
      const {
        before_screenshot: _b,
        after_screenshot: _a,
        diff_screenshot: _d,
        ...rest
      } = r;
      return rest;
    };
    expect(strip(out)).toEqual(strip(base));
  });

  it('does not mutate its input', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    toApiUrls(base);
    expect(base).toEqual(snapshot);
  });
});

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { generatePixelDiff } from '../services/pixelDiff';
import { classifyWithGemini } from '../services/aiClassification';
import { createJiraIssue } from '../services/jiraService';
import { createGitHubIssue } from '../services/githubService';
import { TestResult, AIClassification } from '../types';

const router = Router();

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(process.cwd(), 'results');

[UPLOADS_DIR, RESULTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const STAGING_DIR = path.join(UPLOADS_DIR, '.staging');
if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true });

// Files are staged, then moved into uploads/{run_id}/ once the body is parsed.
//
// Multer streams fields in the order the client wrote them, and both the
// dashboard and the Playwright service append the images BEFORE run_id. A
// destination callback reading req.body.run_id therefore always saw undefined
// and scattered uploads into random uuid folders, while the route handler
// wrote results under the real run id — so GET /api/screenshots/:runId/before
// 404'd on every run. Staging removes the ordering dependency entirely.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STAGING_DIR),
  filename: (_req, file, cb) => {
    cb(null, `${file.fieldname}_${Date.now()}_${uuidv4()}${path.extname(file.originalname)}`);
  },
});

// Must match the guard in routes/screenshots.ts — a run id that can be stored
// but not served would silently break the dashboard's image URLs.
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// POST /api/compare — upload before/after and run comparison
router.post(
  '/',
  upload.fields([{ name: 'before', maxCount: 1 }, { name: 'after', maxCount: 1 }]),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;
      if (!files?.before?.[0] || !files?.after?.[0]) {
        return res.status(400).json({ error: 'Both before and after screenshots required' });
      }

      const runId = req.body.run_id || uuidv4();
      const pageName = req.body.page_name || 'Unknown Page';
      const autoFileBugs = req.body.auto_file_bugs === 'true';
      const jiraProjectKey = req.body.jira_project_key as string;
      const githubOwner = req.body.github_owner as string;
      const githubRepo = req.body.github_repo as string;
      const prNumber = req.body.pr_number as string;

      if (!SAFE_RUN_ID.test(runId)) {
        return res.status(400).json({
          error: 'run_id may only contain letters, numbers, hyphens and underscores',
        });
      }

      // Promote the staged uploads into uploads/{run_id}/ using the layout
      // documented in REQUIREMENTS.md §10.1.
      const uploadDir = path.join(UPLOADS_DIR, runId);
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const stamp = Date.now();
      const beforePath = path.join(
        uploadDir,
        `before_${stamp}${path.extname(files.before[0].originalname) || '.png'}`
      );
      const afterPath = path.join(
        uploadDir,
        `after_${stamp}${path.extname(files.after[0].originalname) || '.png'}`
      );
      fs.renameSync(files.before[0].path, beforePath);
      fs.renameSync(files.after[0].path, afterPath);

      const resultDir = path.join(RESULTS_DIR, runId);
      if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

      // Step 1: Generate pixel diff
      console.log(`[${runId}] Generating pixel diff...`);
      const diffResult = await generatePixelDiff(beforePath, afterPath, resultDir, runId);

      // Step 2: AI Classification
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
        autoFileBugs &&
        (classification.classification === 'BUG' ||
          (classification.classification === 'NEEDS_REVIEW' &&
            classification.severity === 'critical'));

      if (shouldFileBug) {
        // File Jira issue
        if (jiraProjectKey && process.env.JIRA_API_TOKEN) {
          try {
            console.log(`[${runId}] Filing Jira issue...`);
            const jiraKey = await createJiraIssue(
              jiraProjectKey,
              pageName,
              classification,
              runId,
              diffResult.diff_path,
              beforePath,
              afterPath
            );
            result.jira_ticket = jiraKey;
            console.log(`[${runId}] Jira issue created: ${jiraKey}`);
          } catch (err) {
            console.error(`[${runId}] Jira error:`, err);
          }
        }

        // File GitHub issue
        if (githubOwner && githubRepo && process.env.GITHUB_TOKEN) {
          try {
            console.log(`[${runId}] Filing GitHub issue...`);
            const issueUrl = await createGitHubIssue(
              githubOwner,
              githubRepo,
              pageName,
              classification,
              runId,
              prNumber
            );
            result.github_issue = issueUrl;
            console.log(`[${runId}] GitHub issue created: ${issueUrl}`);
          } catch (err) {
            console.error(`[${runId}] GitHub error:`, err);
          }
        }
      }

      // Save result to disk
      const resultFile = path.join(resultDir, `${result.id}.json`);
      fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));

      return res.json({
        success: true,
        result: {
          ...result,
          // Replace local paths with API URLs for frontend
          before_screenshot: `/api/screenshots/${runId}/before`,
          after_screenshot: `/api/screenshots/${runId}/after`,
          diff_screenshot: `/api/screenshots/${runId}/diff`,
        },
      });
    } catch (error: any) {
      console.error('Compare error:', error);

      // Don't leak staged uploads when the run fails partway through.
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      for (const f of [...(files?.before ?? []), ...(files?.after ?? [])]) {
        if (f.path.startsWith(STAGING_DIR) && fs.existsSync(f.path)) {
          try {
            fs.unlinkSync(f.path);
          } catch {
            /* best effort */
          }
        }
      }

      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

// GET /api/compare/results/:runId — fetch all results for a run
router.get('/results/:runId', (req: Request, res: Response) => {
  const { runId } = req.params;
  const resultDir = path.join(RESULTS_DIR, runId);

  if (!fs.existsSync(resultDir)) {
    return res.status(404).json({ error: 'Run not found' });
  }

  const files = fs.readdirSync(resultDir).filter((f) => f.endsWith('.json'));
  const results = files.map((f) =>
    JSON.parse(fs.readFileSync(path.join(resultDir, f), 'utf-8'))
  );

  return res.json({ run_id: runId, results });
});

export default router;

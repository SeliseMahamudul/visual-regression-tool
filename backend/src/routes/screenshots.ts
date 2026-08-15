import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(process.cwd(), 'results');

function findFileByPrefix(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const match = files.find((f) => f.startsWith(prefix));
  return match ? path.join(dir, match) : null;
}

// SEC-09: run ids are generated ids, never user prose. Rejecting anything with
// a separator or dot stops `..%2f..` style traversal out of the storage roots.
const SAFE_RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

router.get('/:runId/:type', (req: Request, res: Response) => {
  const { runId, type } = req.params;

  if (!SAFE_RUN_ID.test(runId)) {
    return res.status(400).json({ error: 'Invalid run id' });
  }
  if (!['before', 'after', 'diff'].includes(type)) {
    return res.status(400).json({ error: 'Type must be one of: before, after, diff' });
  }

  const uploadDir = path.join(UPLOADS_DIR, runId);
  const resultDir = path.join(RESULTS_DIR, runId);

  let filePath: string | null = null;

  if (type === 'before') {
    filePath = findFileByPrefix(uploadDir, 'before_');
  } else if (type === 'after') {
    filePath = findFileByPrefix(uploadDir, 'after_');
  } else if (type === 'diff') {
    filePath = findFileByPrefix(resultDir, `${runId}_diff`);
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Screenshot not found' });
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(path.resolve(filePath));
});

export default router;

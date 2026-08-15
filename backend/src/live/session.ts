import * as fs from 'fs';
import * as path from 'path';
import type { Browser } from 'playwright';
import { PNG } from 'pngjs';
import {
  CaptureRequest,
  CaptureStage,
  FrameMetadata,
  ImageSize,
  LiveError,
  PaneSide,
  PaneState,
  SessionCreateRequest,
  SessionState,
  Viewport,
} from '../types/live';
import { LivePane } from './pane';
import { runComparison, toApiUrls } from '../services/comparisonRunner';
import { deriveRunId } from './sessionManager';
import { TestResult } from '../types';

export interface SessionCallbacks {
  onFrame: (side: PaneSide, frameId: number, data: Buffer, metadata: FrameMetadata) => void;
  onPaneState: (state: PaneState) => void;
  onDialog: (
    side: PaneSide,
    dialog: { type: string; message: string; defaultValue?: string }
  ) => void;
  onError: (err: LiveError) => void;
  onCaptureProgress: (runId: string, stage: CaptureStage) => void;
}

/** Read at call time (CLAUDE.md gotcha #1). */
function uploadsDir(): string {
  return process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
}

export function idleTimeoutMs(): number {
  const raw = Number(process.env.LIVE_IDLE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60 * 1000;
}

function pngSize(filePath: string): ImageSize {
  try {
    const png = PNG.sync.read(fs.readFileSync(filePath));
    return { w: png.width, h: png.height };
  } catch {
    return { w: 0, h: 0 };
  }
}

export interface CaptureOutcome {
  runId: string;
  result: TestResult;
  sizes: Record<PaneSide, ImageSize>;
}

export class LiveSession {
  readonly id: string;
  readonly createdAt = new Date();
  readonly viewport: Viewport;
  readonly socketIds = new Set<string>();

  lastActivityAt = Date.now();
  /** FR-70: run ids DERIVE from the session but are never equal to it. */
  captureSeq = 0;
  detachTimer: NodeJS.Timeout | null = null;

  private readonly panes: Record<PaneSide, LivePane>;
  private capturing = false;
  private closed = false;

  constructor(id: string, viewport: Viewport, private readonly cb: SessionCallbacks) {
    this.id = id;
    this.viewport = viewport;

    const paneCallbacks = (side: PaneSide) => ({
      onFrame: cb.onFrame,
      onState: (_s: PaneSide, state: PaneState) => cb.onPaneState(state),
      onDialog: cb.onDialog,
      onError: (err: Omit<LiveError, 'sessionId'>) =>
        cb.onError({ ...err, sessionId: this.id, pane: err.pane ?? side }),
    });

    this.panes = {
      before: new LivePane('before', viewport, paneCallbacks('before')),
      after: new LivePane('after', viewport, paneCallbacks('after')),
    };
  }

  pane(side: PaneSide): LivePane {
    return this.panes[side];
  }

  /** Activity for the idle reaper. Frames DELIBERATELY do not count (FR-75). */
  touch(): void {
    this.lastActivityAt = Date.now();
  }

  isIdlePast(now: number): boolean {
    return now - this.lastActivityAt > idleTimeoutMs();
  }

  async open(browser: Browser, req: SessionCreateRequest): Promise<void> {
    // Sequential, not Promise.all: two simultaneous context launches on a cold
    // Chromium contend badly on Windows and one occasionally times out.
    await this.panes.before.open(browser, req.urlBefore, req.httpCredentials?.before);
    await this.panes.after.open(browser, req.urlAfter, req.httpCredentials?.after);
  }

  state(): SessionState {
    return {
      sessionId: this.id,
      createdAt: this.createdAt.toISOString(),
      expiresAt: new Date(this.lastActivityAt + idleTimeoutMs()).toISOString(),
      viewport: this.viewport,
      panes: { before: this.panes.before.state, after: this.panes.after.state },
    };
  }

  async pauseStreams(): Promise<void> {
    await Promise.all([
      this.panes.before.stopScreencast(),
      this.panes.after.stopScreencast(),
    ]);
  }

  /** FR-74: on reattach, restart AND force one frame — see LivePane.nudgeFrame. */
  async resumeStreams(): Promise<void> {
    await Promise.all([
      this.panes.before.startScreencast(),
      this.panes.after.startScreencast(),
    ]);
    await this.nudgeFrames();
  }

  async nudgeFrames(): Promise<void> {
    await Promise.all([this.panes.before.nudgeFrame(), this.panes.after.nudgeFrame()]);
  }

  /**
   * FR-68: one action captures both panes and runs the existing pipeline.
   * In-process — see WEB_APP_REGRESSION_PLAN §3.6 for why this is not a
   * loopback multipart POST to /api/compare.
   */
  async runCapture(req: CaptureRequest): Promise<CaptureOutcome> {
    if (this.capturing) {
      const err = new Error('A capture is already running for this session.');
      err.name = 'CaptureBusyError';
      throw err;
    }
    this.capturing = true;
    this.touch();

    // FR-70 / CLAUDE.md gotcha #4: a fresh run id per capture. Sharing one id
    // means the second capture overwrites the first's diff and every card but
    // the newest shows the wrong images.
    const runId = deriveRunId(this.id, ++this.captureSeq);
    const uploadDir = path.join(uploadsDir(), runId);
    fs.mkdirSync(uploadDir, { recursive: true });

    const stamp = Date.now();
    const beforePath = path.join(uploadDir, `before_${stamp}.png`);
    const afterPath = path.join(uploadDir, `after_${stamp}.png`);

    try {
      this.cb.onCaptureProgress(runId, 'pausing');
      this.cb.onCaptureProgress(runId, 'capturing');

      await Promise.all([
        this.panes.before.capture(beforePath, {
          fullPage: req.full_page,
          hideDynamic: req.hide_dynamic,
        }),
        this.panes.after.capture(afterPath, {
          fullPage: req.full_page,
          hideDynamic: req.hide_dynamic,
        }),
      ]);

      const { result } = await runComparison(beforePath, afterPath, {
        runId,
        pageName: req.page_name || 'Live Comparison',
        autoFileBugs: !!req.auto_file_bugs,
        jiraProjectKey: req.jira_project_key,
        githubOwner: req.github_owner,
        githubRepo: req.github_repo,
        prNumber: req.pr_number,
        expectations: req.expectations,
        onProgress: (stage) => this.cb.onCaptureProgress(runId, stage),
      });

      this.cb.onCaptureProgress(runId, 'done');
      this.touch();

      return {
        runId,
        // FR-69: the existing, unmodified ResultCard renders this shape already.
        result: toApiUrls(result),
        sizes: { before: pngSize(beforePath), after: pngSize(afterPath) },
      };
    } finally {
      this.capturing = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.detachTimer) clearTimeout(this.detachTimer);
    await Promise.all([this.panes.before.close(), this.panes.after.close()]);
    // Memory growth over long sessions is a known risk — record it on the way out.
    console.log(
      `[live] session ${this.id} closed; rss=${Math.round(
        process.memoryUsage().rss / 1024 / 1024
      )}MB`
    );
  }
}

/**
 * Live-mode Socket.IO protocol (WEB_APP_REGRESSION_PLAN §3.5).
 *
 * Deliberately duplicated in frontend/src/types/live.ts rather than shared
 * through a fourth package — this repo already duplicates src/types/index.ts
 * across backend and frontend, and live mode follows that convention.
 * Keep the two files in sync.
 */

export type PaneSide = 'before' | 'after';

export interface Viewport {
  width: number;
  height: number;
}

export interface PaneState {
  side: PaneSide;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** true while a window.open child owns the pane (FR-73, SSO flows) */
  isPopup: boolean;
  lastError?: string;
}

export interface SessionState {
  sessionId: string;
  createdAt: string;
  /** idle deadline, refreshed on activity (FR-75) */
  expiresAt: string;
  viewport: Viewport;
  panes: Record<PaneSide, PaneState>;
}

export interface FrameMetadata {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp?: number;
}

export type LiveInputEvent =
  | {
      kind: 'mouse';
      type: 'down' | 'up' | 'move';
      x: number;
      y: number;
      button: 'left' | 'right' | 'middle' | 'none';
      buttons: number;
      clickCount: number;
      modifiers: number;
    }
  | {
      kind: 'wheel';
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      modifiers: number;
    }
  | {
      kind: 'key';
      type: 'down' | 'up';
      key: string;
      code: string;
      modifiers: number;
      repeat: boolean;
    }
  /** paste / IME commit */
  | { kind: 'text'; text: string };

export interface HttpCredentials {
  username: string;
  password: string;
}

export interface SessionCreateRequest {
  urlBefore: string;
  urlAfter: string;
  viewport?: Viewport;
  /** FR-71 — never stored, never logged. Held only in the Playwright context. */
  httpCredentials?: Partial<Record<PaneSide, HttpCredentials>>;
}

export interface CaptureRequest {
  sessionId: string;
  page_name: string;
  hide_dynamic: boolean;
  full_page: boolean;
  auto_file_bugs: boolean;
  jira_project_key?: string;
  github_owner?: string;
  github_repo?: string;
  pr_number?: string;
}

export type LiveErrorCode =
  | 'SESSION_LIMIT'
  | 'SESSION_NOT_FOUND'
  | 'URL_REJECTED'
  | 'NAV_FAILED'
  | 'HTTP_401_BASIC_AUTH'
  | 'CAPTURE_FAILED'
  | 'CLASSIFY_FAILED'
  | 'SCREENSHOT_TOO_LARGE'
  | 'BROWSER_UNAVAILABLE'
  | 'BAD_REQUEST';

export interface LiveError {
  code: LiveErrorCode;
  message: string;
  sessionId?: string;
  pane?: PaneSide;
}

export type CaptureStage =
  | 'pausing'
  | 'capturing'
  | 'diffing'
  | 'classifying'
  | 'filing'
  | 'done';

export type SessionCloseReason = 'user' | 'idle' | 'error' | 'shutdown';

export interface ImageSize {
  w: number;
  h: number;
}

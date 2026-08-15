import { useCallback, useEffect, useRef, useState } from 'react';
import { getLiveSocket, SESSION_STORAGE_KEY } from './socket';
import {
  CaptureStage,
  ImageSize,
  LiveError,
  LiveInputEvent,
  PaneSide,
  PaneState,
  SessionCloseReason,
  SessionCreateRequest,
  SessionState,
} from '../types/live';
import { ExpectationRules, TestResult } from '../types';

export interface DialogRequest {
  pane: PaneSide;
  type: string;
  message: string;
  defaultValue?: string;
}

export interface CaptureOptions {
  page_name: string;
  hide_dynamic: boolean;
  full_page: boolean;
  auto_file_bugs: boolean;
  jira_project_key?: string;
  github_owner?: string;
  github_repo?: string;
}

export interface LiveSessionApi {
  session: SessionState | null;
  starting: boolean;
  capturing: boolean;
  stage: CaptureStage | null;
  error: LiveError | null;
  dialog: DialogRequest | null;
  sizes: Record<PaneSide, ImageSize> | null;
  /** FR-55: set once for the session, applied to every capture until changed. */
  expectations: ExpectationRules | undefined;
  setExpectations: (rules: ExpectationRules | undefined) => void;
  start: (req: SessionCreateRequest) => Promise<void>;
  close: () => Promise<void>;
  navigate: (pane: PaneSide, url: string) => void;
  history: (pane: PaneSide, action: 'back' | 'forward' | 'reload' | 'stop') => void;
  sendInput: (pane: PaneSide, event: LiveInputEvent) => void;
  respondToDialog: (accept: boolean, promptText?: string) => void;
  capture: (opts: CaptureOptions) => Promise<TestResult | null>;
  clearError: () => void;
}

export function useLiveSession(onResult: (r: TestResult) => void): LiveSessionApi {
  const [session, setSession] = useState<SessionState | null>(null);
  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [stage, setStage] = useState<CaptureStage | null>(null);
  const [error, setError] = useState<LiveError | null>(null);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [sizes, setSizes] = useState<Record<PaneSide, ImageSize> | null>(null);
  const [expectations, setExpectations] = useState<ExpectationRules | undefined>(undefined);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = getLiveSocket();

    const onSessionState = (s: SessionState) => {
      sessionIdRef.current = s.sessionId;
      setSession(s);
    };
    const onPaneState = (p: PaneState & { sessionId: string }) => {
      setSession((prev) =>
        prev && prev.sessionId === p.sessionId
          ? { ...prev, panes: { ...prev.panes, [p.side]: p } }
          : prev
      );
    };
    const onClosed = ({ reason }: { sessionId: string; reason: SessionCloseReason }) => {
      sessionIdRef.current = null;
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      setSession(null);
      setExpectations(undefined);
      if (reason !== 'user') {
        setError({ code: 'SESSION_NOT_FOUND', message: `Live session ended (${reason}).` });
      }
    };
    const onProgress = ({ stage: s }: { stage: CaptureStage }) => setStage(s);
    const onDialogEvent = (d: DialogRequest & { sessionId: string }) => setDialog(d);
    const onLiveError = (e: LiveError) => setError(e);

    socket.on('session:state', onSessionState);
    socket.on('pane:state', onPaneState);
    socket.on('session:closed', onClosed);
    socket.on('capture:progress', onProgress);
    socket.on('pane:dialog', onDialogEvent);
    socket.on('live:error', onLiveError);

    // FR-74: reattach to a session that survived a dashboard reload.
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    const attach = () => {
      if (!stored) return;
      socket.emit('session:attach', { sessionId: stored }, (err: LiveError | null, s?: SessionState) => {
        if (err || !s) {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
          return;
        }
        sessionIdRef.current = s.sessionId;
        setSession(s);
      });
    };
    if (socket.connected) attach();
    else socket.once('connect', attach);

    return () => {
      socket.off('session:state', onSessionState);
      socket.off('pane:state', onPaneState);
      socket.off('session:closed', onClosed);
      socket.off('capture:progress', onProgress);
      socket.off('pane:dialog', onDialogEvent);
      socket.off('live:error', onLiveError);
    };
  }, []);

  const start = useCallback(async (req: SessionCreateRequest) => {
    setStarting(true);
    setError(null);
    try {
      await new Promise<void>((resolve) => {
        getLiveSocket().emit(
          'session:create',
          req,
          (err: LiveError | null, s?: SessionState) => {
            if (err || !s) {
              setError(err ?? { code: 'BAD_REQUEST', message: 'Could not start the session.' });
            } else {
              sessionIdRef.current = s.sessionId;
              sessionStorage.setItem(SESSION_STORAGE_KEY, s.sessionId);
              setSession(s);
            }
            resolve();
          }
        );
      });
    } finally {
      setStarting(false);
    }
  }, []);

  const close = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    await new Promise<void>((resolve) => {
      getLiveSocket().emit('session:close', { sessionId: id }, () => resolve());
    });
    sessionIdRef.current = null;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    setExpectations(undefined);
  }, []);

  const navigate = useCallback((pane: PaneSide, url: string) => {
    const id = sessionIdRef.current;
    if (id) getLiveSocket().emit('pane:navigate', { sessionId: id, pane, url });
  }, []);

  const history = useCallback(
    (pane: PaneSide, action: 'back' | 'forward' | 'reload' | 'stop') => {
      const id = sessionIdRef.current;
      if (id) getLiveSocket().emit('pane:history', { sessionId: id, pane, action });
    },
    []
  );

  const sendInput = useCallback((pane: PaneSide, event: LiveInputEvent) => {
    const id = sessionIdRef.current;
    if (id) getLiveSocket().emit('pane:input', { sessionId: id, pane, event });
  }, []);

  const respondToDialog = useCallback(
    (accept: boolean, promptText?: string) => {
      const id = sessionIdRef.current;
      const pane = dialog?.pane;
      setDialog(null);
      if (id && pane) {
        getLiveSocket().emit('pane:dialogRespond', { sessionId: id, pane, accept, promptText });
      }
    },
    [dialog]
  );

  const capture = useCallback(
    async (opts: CaptureOptions): Promise<TestResult | null> => {
      const id = sessionIdRef.current;
      if (!id) return null;
      setCapturing(true);
      setStage('pausing');
      setError(null);
      try {
        return await new Promise<TestResult | null>((resolve) => {
          getLiveSocket().emit(
            'capture:run',
            { sessionId: id, ...opts, expectations },
            (err: LiveError | null, result?: TestResult) => {
              if (err || !result) {
                setError(err ?? { code: 'CAPTURE_FAILED', message: 'Capture failed.' });
                resolve(null);
                return;
              }
              onResult(result);
              resolve(result);
            }
          );
        });
      } finally {
        setCapturing(false);
        setStage(null);
      }
    },
    [onResult, expectations]
  );

  // Size mismatch warning data (§6): two live panes rarely scroll to identical
  // heights, and normalizeImageSize stretches rather than pads.
  useEffect(() => {
    const socket = getLiveSocket();
    const onCaptureResult = (p: { sizes: Record<PaneSide, ImageSize> }) => setSizes(p.sizes);
    socket.on('capture:result', onCaptureResult);
    return () => {
      socket.off('capture:result', onCaptureResult);
    };
  }, []);

  return {
    session,
    starting,
    capturing,
    stage,
    error,
    dialog,
    sizes,
    expectations,
    setExpectations,
    start,
    close,
    navigate,
    history,
    sendInput,
    respondToDialog,
    capture,
    clearError: () => setError(null),
  };
}

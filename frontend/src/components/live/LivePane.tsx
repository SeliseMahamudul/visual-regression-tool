import { useEffect, useRef, useState } from 'react';
import { getLiveSocket } from '../../live/socket';
import { FrameRenderer } from '../../live/frameRenderer';
import {
  keyEventToInput,
  mouseEventToInput,
  modifierBitmask,
  shouldPreventDefault,
  toViewportCoords,
} from '../../live/inputMap';
import { FrameMetadata, LiveInputEvent, PaneSide, PaneState, Viewport } from '../../types/live';
import { PaneToolbar } from './PaneToolbar';

interface Props {
  side: PaneSide;
  label: string;
  sessionId: string;
  viewport: Viewport;
  state: PaneState;
  dimmed: boolean;
  onNavigate: (url: string) => void;
  onHistory: (action: 'back' | 'forward' | 'reload' | 'stop') => void;
  sendInput: (event: LiveInputEvent) => void;
}

export function LivePane(props: Props) {
  const { side, sessionId, viewport, state, dimmed, sendInput } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<FrameRenderer | null>(null);
  const [focused, setFocused] = useState(false);
  const [bps, setBps] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // ── frames ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new FrameRenderer(canvas);
    rendererRef.current = renderer;

    const socket = getLiveSocket();
    const onFrame = (p: {
      sessionId: string;
      pane: PaneSide;
      frameId: number;
      data: ArrayBuffer;
      metadata: FrameMetadata;
    }) => {
      if (p.pane !== side || p.sessionId !== sessionId) return;
      void renderer.draw(p.frameId, p.data, p.metadata);
    };
    socket.on('pane:frame', onFrame);

    const meter = setInterval(() => setBps(renderer.bytesPerSecond), 1000);
    return () => {
      socket.off('pane:frame', onFrame);
      clearInterval(meter);
      rendererRef.current = null;
    };
  }, [side, sessionId]);

  // ── wheel: MUST be non-passive, or the dashboard scrolls instead of the pane ─
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let acc = { deltaX: 0, deltaY: 0 };
    let raf = 0;
    let last: WheelEvent | null = null;

    const flush = () => {
      raf = 0;
      const m = rendererRef.current?.metadata;
      if (!m || !last || (acc.deltaX === 0 && acc.deltaY === 0)) return;
      const { x, y } = toViewportCoords(last, canvas.getBoundingClientRect(), m);
      sendInput({
        kind: 'wheel',
        x,
        y,
        deltaX: acc.deltaX,
        deltaY: acc.deltaY,
        modifiers: modifierBitmask(last),
      });
      acc = { deltaX: 0, deltaY: 0 };
    };

    const handler = (ev: WheelEvent) => {
      // React's onWheel prop is passive and CANNOT preventDefault, which is why
      // this listener is registered by hand.
      ev.preventDefault();
      last = ev;
      // Raw wheel events fire 100+/s on precision trackpads; coalesce per frame.
      acc.deltaX += ev.deltaX;
      acc.deltaY += ev.deltaY;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    canvas.addEventListener('wheel', handler, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handler);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sendInput]);

  // ── mouse ─────────────────────────────────────────────────────────────────
  const moveRaf = useRef(0);
  const pendingMove = useRef<MouseEvent | null>(null);

  const dispatchMouse = (ev: React.MouseEvent, type: 'down' | 'up' | 'move') => {
    const canvas = canvasRef.current;
    const m = rendererRef.current?.metadata;
    if (!canvas || !m) return;
    sendInput(mouseEventToInput(ev.nativeEvent, type, canvas.getBoundingClientRect(), m));
  };

  const onMouseMove = (ev: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Client-side cursor: the pointer feels instant even while hover state lags.
    const rect = canvas.getBoundingClientRect();
    setCursor({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });

    pendingMove.current = ev.nativeEvent;
    if (moveRaf.current) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0;
      const native = pendingMove.current;
      const m = rendererRef.current?.metadata;
      if (!native || !m || !canvasRef.current) return;
      sendInput(
        mouseEventToInput(native, 'move', canvasRef.current.getBoundingClientRect(), m)
      );
    });
  };

  // ── keyboard ──────────────────────────────────────────────────────────────
  const onKey = (ev: React.KeyboardEvent, type: 'down' | 'up') => {
    if (shouldPreventDefault(ev.nativeEvent)) ev.preventDefault();
    sendInput(keyEventToInput(ev.nativeEvent, type));
  };

  const onPaste = (ev: React.ClipboardEvent) => {
    ev.preventDefault();
    const text = ev.clipboardData.getData('text');
    // Makes password managers usable — nothing is stored or logged.
    if (text) sendInput({ kind: 'text', text });
  };

  return (
    <div
      className={`rounded-xl overflow-hidden border transition-colors ${
        focused ? 'border-violet-500' : 'border-slate-700'
      }`}
    >
      <PaneToolbar
        state={state}
        label={props.label}
        bytesPerSecond={bps}
        onNavigate={props.onNavigate}
        onHistory={props.onHistory}
      />
      <div className="relative bg-slate-950">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          // A visible focus ring is essential UX, not polish: without it,
          // typing a password into the wrong pane is a routine mistake.
          className="w-full h-auto block outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500 cursor-none"
          style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMouseDown={(e) => {
            e.currentTarget.focus();
            dispatchMouse(e, 'down');
          }}
          onMouseUp={(e) => dispatchMouse(e, 'up')}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setCursor(null)}
          onContextMenu={(e) => {
            // Keep the dashboard's own menu shut; the page gets a right-click.
            e.preventDefault();
          }}
          onKeyDown={(e) => onKey(e, 'down')}
          onKeyUp={(e) => onKey(e, 'up')}
          onPaste={onPaste}
        />

        {cursor && (
          <div
            className="pointer-events-none absolute w-2.5 h-2.5 -ml-1 -mt-1 rounded-full bg-violet-400/80 ring-2 ring-white/40"
            style={{ left: cursor.x, top: cursor.y }}
          />
        )}

        {dimmed && (
          <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center">
            <span className="text-sm text-slate-200 font-medium">Capturing…</span>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { PaneState } from '../../types/live';
import { ArrowLeft, ArrowRight, RotateCw, X, ExternalLink } from 'lucide-react';

interface Props {
  state: PaneState;
  label: string;
  bytesPerSecond: number;
  onNavigate: (url: string) => void;
  onHistory: (action: 'back' | 'forward' | 'reload' | 'stop') => void;
}

/** FR-67: URL bar plus back / forward / reload / stop, per pane. */
export function PaneToolbar({ state, label, bytesPerSecond, onNavigate, onHistory }: Props) {
  const [draft, setDraft] = useState(state.url);
  const [editing, setEditing] = useState(false);

  // Follow the pane's own navigation unless the user is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(state.url);
  }, [state.url, editing]);

  const btn =
    'p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors';

  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1.5">
          {label}
        </span>
        <button className={btn} disabled={!state.canGoBack} onClick={() => onHistory('back')} title="Back">
          <ArrowLeft size={14} />
        </button>
        <button
          className={btn}
          disabled={!state.canGoForward}
          onClick={() => onHistory('forward')}
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        {state.loading ? (
          <button className={btn} onClick={() => onHistory('stop')} title="Stop">
            <X size={14} />
          </button>
        ) : (
          <button className={btn} onClick={() => onHistory('reload')} title="Reload">
            <RotateCw size={14} />
          </button>
        )}

        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            onNavigate(draft.trim());
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            spellCheck={false}
            className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1 text-xs text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-blue-900"
          />
        </form>

        {state.isPopup && (
          <span
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
            title="A pop-up window opened by the page owns this pane (SSO). It reverts when the pop-up closes."
          >
            <ExternalLink size={10} /> popup
          </span>
        )}
        {state.loading && (
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" title="Loading" />
        )}
      </div>

      <div className="flex items-center justify-between px-3 pb-1.5 text-[10px] text-slate-500">
        <span className="truncate max-w-[70%]">{state.title || '—'}</span>
        <span title="Screencast bandwidth for this pane">
          {bytesPerSecond > 0 ? `${(bytesPerSecond / 1024).toFixed(0)} KB/s` : 'idle'}
        </span>
      </div>

      {state.lastError && (
        <div className="px-3 pb-1.5 text-[10px] text-red-600 truncate">{state.lastError}</div>
      )}
    </div>
  );
}

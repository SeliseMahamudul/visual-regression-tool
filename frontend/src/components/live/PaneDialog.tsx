import { useEffect, useState } from 'react';
import { DialogRequest } from '../../live/useLiveSession';
import { AlertTriangle } from 'lucide-react';

interface Props {
  dialog: DialogRequest;
  onRespond: (accept: boolean, promptText?: string) => void;
}

/**
 * FR-72: JS dialogs are surfaced, not auto-dismissed.
 *
 * Playwright auto-dismisses alert/confirm/prompt when no handler is
 * registered, so any login flow that confirms would break in a way that looks
 * like the page ignoring the click.
 */
export function PaneDialog({ dialog, onRespond }: Props) {
  const [text, setText] = useState(dialog.defaultValue ?? '');

  useEffect(() => setText(dialog.defaultValue ?? ''), [dialog]);

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center pt-16 bg-slate-950/70">
      <div className="w-[420px] max-w-[90%] bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={16} className="text-amber-400" />
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {dialog.type} · {dialog.pane === 'before' ? 'reference' : 'candidate'} pane
          </span>
        </div>

        <p className="text-sm text-slate-200 whitespace-pre-wrap break-words mb-4">
          {dialog.message || '(no message)'}
        </p>

        {dialog.type === 'prompt' && (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRespond(true, text);
            }}
            className="w-full mb-4 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        )}

        <div className="flex justify-end gap-2">
          {dialog.type !== 'alert' && (
            <button
              onClick={() => onRespond(false)}
              className="px-3 py-1.5 text-sm rounded-lg text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => onRespond(true, dialog.type === 'prompt' ? text : undefined)}
            className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

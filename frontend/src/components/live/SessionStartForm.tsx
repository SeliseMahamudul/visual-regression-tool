import { useState } from 'react';
import { SessionCreateRequest } from '../../types/live';
import { Play, Lock, Loader2 } from 'lucide-react';

interface Props {
  onStart: (req: SessionCreateRequest) => void;
  starting: boolean;
}

const VIEWPORTS = [
  { label: 'Desktop 1280×800', width: 1280, height: 800 },
  { label: 'Laptop 1440×900', width: 1440, height: 900 },
  { label: 'Tablet 1024×768', width: 1024, height: 768 },
];

/** FR-63: two URLs in, two live interactive panes out. */
export function SessionStartForm({ onStart, starting }: Props) {
  const [urlBefore, setUrlBefore] = useState('');
  const [urlAfter, setUrlAfter] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [authBefore, setAuthBefore] = useState({ username: '', password: '' });
  const [authAfter, setAuthAfter] = useState({ username: '', password: '' });
  const [vp, setVp] = useState(0);

  const field =
    'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart({
      urlBefore: urlBefore.trim(),
      urlAfter: urlAfter.trim(),
      viewport: { width: VIEWPORTS[vp].width, height: VIEWPORTS[vp].height },
      httpCredentials: {
        before: authBefore.username ? authBefore : undefined,
        after: authAfter.username ? authAfter : undefined,
      },
    });
  };

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-6 max-w-3xl mx-auto shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Compare two live environments</h2>
      <p className="text-sm text-slate-500 mb-5">
        Both applications open as interactive panes below. Log in and navigate each one yourself, then
        capture both at once. Credentials you type go straight into the page — nothing is stored.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1.5">Reference / stage</label>
          <input
            className={field}
            placeholder="https://stage.example.com"
            value={urlBefore}
            onChange={(e) => setUrlBefore(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1.5">Candidate / dev</label>
          <input
            className={field}
            placeholder="https://dev.example.com"
            value={urlAfter}
            onChange={(e) => setUrlAfter(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs text-slate-500 mb-1.5">Viewport</label>
        <select
          className={field}
          value={vp}
          onChange={(e) => setVp(Number(e.target.value))}
        >
          {VIEWPORTS.map((v, i) => (
            <option key={v.label} value={i}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setShowAuth((s) => !s)}
        className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors"
      >
        <Lock size={12} />
        HTTP basic auth (optional)
      </button>

      {showAuth && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <p className="md:col-span-2 text-[11px] text-slate-500">
            Basic auth is a native browser dialog — it never appears in the pane, so the page would
            just sit blank. Supply credentials here instead (FR-71).
          </p>
          {([['Reference / stage', authBefore, setAuthBefore], ['Candidate / dev', authAfter, setAuthAfter]] as const).map(
            ([label, value, set]) => (
              <div key={label} className="space-y-2">
                <div className="text-xs text-slate-500">{label}</div>
                <input
                  className={field}
                  placeholder="username"
                  autoComplete="off"
                  value={value.username}
                  onChange={(e) => set({ ...value, username: e.target.value })}
                />
                <input
                  className={field}
                  type="password"
                  placeholder="password"
                  autoComplete="off"
                  value={value.password}
                  onChange={(e) => set({ ...value, password: e.target.value })}
                />
              </div>
            )
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={starting || !urlBefore.trim() || !urlAfter.trim()}
        className="mt-6 w-full flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium rounded-lg py-2.5 transition-colors shadow-sm"
      >
        {starting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
        {starting ? 'Launching browsers…' : 'Start live session'}
      </button>

      <p className="mt-4 text-[11px] text-slate-500 leading-relaxed">
        Known limitations: native <code>&lt;select&gt;</code> dropdowns, date pickers, autofill and the
        context menu are OS widgets and do not render in a pane — click the control, then use the
        arrow keys and Enter, which do work. File inputs are out of scope for v1. This is a
        comparison tool, not a remote desktop: expect a little input lag.
      </p>
    </form>
  );
}

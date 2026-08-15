import { useState } from 'react';
import { CaptureStage, ImageSize, PaneSide } from '../../types/live';
import { CaptureOptions } from '../../live/useLiveSession';
import { Camera, Loader2, Power, AlertTriangle } from 'lucide-react';

interface Props {
  capturing: boolean;
  stage: CaptureStage | null;
  sizes: Record<PaneSide, ImageSize> | null;
  onCapture: (opts: CaptureOptions) => void;
  onClose: () => void;
}

const STAGE_LABEL: Record<CaptureStage, string> = {
  pausing: 'Pausing streams…',
  capturing: 'Capturing both panes…',
  diffing: 'Computing pixel diff…',
  classifying: 'Asking the vision model…',
  filing: 'Filing bug reports…',
  done: 'Done',
};

export function CaptureBar({ capturing, stage, sizes, onCapture, onClose }: Props) {
  const [pageName, setPageName] = useState('');
  const [hideDynamic, setHideDynamic] = useState(true);
  const [fullPage, setFullPage] = useState(false);
  const [autoFile, setAutoFile] = useState(false);
  const [jira, setJira] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');

  // §6: normalizeImageSize STRETCHES rather than pads, so a height mismatch
  // inflates the diff percentage. Say so rather than let the number mislead.
  const mismatch =
    sizes && sizes.before.h > 0 && sizes.after.h > 0
      ? Math.abs(sizes.before.h - sizes.after.h) / Math.max(sizes.before.h, sizes.after.h)
      : 0;

  const check = (label: string, value: boolean, set: (v: boolean) => void, title?: string) => (
    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer" title={title}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => set(e.target.checked)}
        className="accent-blue-900"
      />
      {label}
    </label>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={pageName}
          onChange={(e) => setPageName(e.target.value)}
          placeholder="Page name (e.g. Checkout)"
          className="flex-1 min-w-[200px] bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-900"
        />
        {check('Hide dynamic elements', hideDynamic, setHideDynamic, 'Hides timestamps, avatars and ads before capture (FR-04). Turn off if you specifically want to compare them.')}
        {check('Full page', fullPage, setFullPage, 'Captures beyond the viewport. Very tall pages are refused rather than silently truncated.')}
        {check('Auto-file bugs', autoFile, setAutoFile)}

        <button
          onClick={() =>
            onCapture({
              page_name: pageName || 'Live Comparison',
              hide_dynamic: hideDynamic,
              full_page: fullPage,
              auto_file_bugs: autoFile,
              jira_project_key: jira || undefined,
              github_owner: owner || undefined,
              github_repo: repo || undefined,
            })
          }
          disabled={capturing}
          className="flex items-center gap-2 bg-blue-900 hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg px-4 py-1.5 transition-colors shadow-sm"
        >
          {capturing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          Compare
        </button>

        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors"
          title="Close the live session and release its browsers"
        >
          <Power size={14} /> End session
        </button>
      </div>

      {autoFile && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {[
            ['Jira project key', jira, setJira],
            ['GitHub owner', owner, setOwner],
            ['GitHub repo', repo, setRepo],
          ].map(([label, value, set]) => (
            <input
              key={label as string}
              value={value as string}
              onChange={(e) => (set as (v: string) => void)(e.target.value)}
              placeholder={label as string}
              className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-900"
            />
          ))}
        </div>
      )}

      {capturing && stage && (
        <div className="text-xs text-blue-700">{STAGE_LABEL[stage]}</div>
      )}

      {mismatch > 0.02 && (
        <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            The two captures differ in height by {(mismatch * 100).toFixed(1)}% (
            {sizes?.before.w}×{sizes?.before.h} vs {sizes?.after.w}×{sizes?.after.h}). The diff
            engine resizes rather than pads, so the reported percentage is inflated. Prefer
            viewport-only capture for a like-for-like comparison.
          </span>
        </div>
      )}
    </div>
  );
}

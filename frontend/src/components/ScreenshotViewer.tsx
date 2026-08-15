import React, { useState } from 'react';

type ViewMode = 'side-by-side' | 'diff' | 'before' | 'after';

interface Props {
  beforeUrl: string;
  afterUrl: string;
  diffUrl: string;
  pageName: string;
}

export const ScreenshotViewer: React.FC<Props> = ({ beforeUrl, afterUrl, diffUrl, pageName }) => {
  const [mode, setMode] = useState<ViewMode>('side-by-side');

  const tabs: { id: ViewMode; label: string }[] = [
    { id: 'side-by-side', label: 'Side by Side' },
    { id: 'diff', label: 'Diff View' },
    { id: 'before', label: 'Before' },
    { id: 'after', label: 'After' },
  ];

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-slate-700 bg-slate-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              mode === tab.id
                ? 'text-violet-400 border-b-2 border-violet-400 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center px-4">
          <span className="text-xs text-slate-500 font-mono">{pageName}</span>
        </div>
      </div>

      {/* Image display */}
      <div className="p-4">
        {mode === 'side-by-side' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">Before</p>
              <img src={beforeUrl} alt="Before" className="w-full rounded border border-slate-600 object-top" />
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">After</p>
              <img src={afterUrl} alt="After" className="w-full rounded border border-slate-600 object-top" />
            </div>
          </div>
        )}
        {mode === 'diff' && (
          <div>
            <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
              Diff — <span className="text-red-400">Red pixels = changed areas</span>
            </p>
            <img src={diffUrl} alt="Diff" className="w-full rounded border border-slate-600" />
          </div>
        )}
        {mode === 'before' && (
          <img src={beforeUrl} alt="Before" className="w-full rounded border border-slate-600" />
        )}
        {mode === 'after' && (
          <img src={afterUrl} alt="After" className="w-full rounded border border-slate-600" />
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { TestResult } from '../types';
import { ClassificationBadge } from './ClassificationBadge';
import { ScreenshotViewer } from './ScreenshotViewer';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

interface Props {
  result: TestResult;
}

export const ResultCard: React.FC<Props> = ({ result }) => {
  const [expanded, setExpanded] = useState(
    result.classification.classification === 'BUG' ||
    result.classification.classification === 'NEEDS_REVIEW'
  );

  const { classification } = result;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-slate-900 font-semibold">{result.page_name}</span>
            <ClassificationBadge
              classification={classification.classification}
              severity={classification.severity}
              confidence={classification.confidence}
            />
          </div>
          <p className="text-slate-500 text-sm mt-1 truncate">{classification.component}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Diff % pill */}
          <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">
            {classification.diff_percentage.toFixed(2)}% diff
          </span>

          {/* Jira / GitHub links */}
          {result.jira_ticket && (
            <a
              href={result.jira_url || '#'}
              target={result.jira_url ? '_blank' : undefined}
              rel={result.jira_url ? 'noopener noreferrer' : undefined}
              onClick={(e) => e.stopPropagation()}
              className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded flex items-center gap-1 hover:bg-blue-100"
            >
              🎫 {result.jira_ticket}
            </a>
          )}
          {result.github_issue && (
            <a
              href={result.github_issue}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-1 rounded flex items-center gap-1 hover:bg-purple-100"
            >
              🐙 <ExternalLink size={10} />
            </a>
          )}

          {expanded ? (
            <ChevronUp size={18} className="text-slate-400" />
          ) : (
            <ChevronDown size={18} className="text-slate-400" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-200 p-4 space-y-4">
          {/* AI Analysis */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 font-medium">AI Explanation</p>
              <p className="text-slate-700 text-sm leading-relaxed">{classification.explanation}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 font-medium">Recommended Action</p>
              <p className="text-slate-700 text-sm leading-relaxed">{classification.recommended_action}</p>
            </div>
          </div>

          {/* Screenshot viewer */}
          <ScreenshotViewer
            beforeUrl={result.before_screenshot}
            afterUrl={result.after_screenshot}
            diffUrl={result.diff_screenshot}
            pageName={result.page_name}
          />
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { ClassificationResult, Severity } from '../types';

interface Props {
  classification: ClassificationResult;
  severity: Severity;
  confidence: number;
}

const classificationConfig: Record<ClassificationResult, { label: string; bg: string; text: string; border: string }> = {
  BUG:               { label: '🐛 Bug',              bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
  INTENTIONAL_CHANGE:{ label: '✅ Intentional',      bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  DYNAMIC_CONTENT:   { label: '🔄 Dynamic Content',  bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  NEEDS_REVIEW:      { label: '⚠️ Needs Review',     bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
};

const severityConfig: Record<Severity, { label: string; color: string }> = {
  critical: { label: 'CRITICAL', color: 'text-red-600' },
  medium:   { label: 'MEDIUM',   color: 'text-amber-600' },
  low:      { label: 'LOW',      color: 'text-yellow-600' },
  none:     { label: 'NONE',     color: 'text-slate-500' },
};

export const ClassificationBadge: React.FC<Props> = ({ classification, severity, confidence }) => {
  const cls = classificationConfig[classification];
  const sev = severityConfig[severity];

  return (
    <div className={`inline-flex flex-col gap-1 px-3 py-2 rounded-lg border ${cls.bg} ${cls.border}`}>
      <span className={`font-bold text-sm ${cls.text}`}>{cls.label}</span>
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-mono font-bold ${sev.color}`}>{sev.label}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">{confidence}% confidence</span>
      </div>
    </div>
  );
};

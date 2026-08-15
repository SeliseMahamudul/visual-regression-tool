import React from 'react';
import { ClassificationResult, Severity } from '../types';

interface Props {
  classification: ClassificationResult;
  severity: Severity;
  confidence: number;
}

const classificationConfig: Record<ClassificationResult, { label: string; bg: string; text: string; border: string }> = {
  BUG:               { label: '🐛 Bug',              bg: 'bg-red-950',    text: 'text-red-300',    border: 'border-red-700' },
  INTENTIONAL_CHANGE:{ label: '✅ Intentional',      bg: 'bg-green-950',  text: 'text-green-300',  border: 'border-green-700' },
  DYNAMIC_CONTENT:   { label: '🔄 Dynamic Content',  bg: 'bg-blue-950',   text: 'text-blue-300',   border: 'border-blue-700' },
  NEEDS_REVIEW:      { label: '⚠️ Needs Review',     bg: 'bg-amber-950',  text: 'text-amber-300',  border: 'border-amber-700' },
};

const severityConfig: Record<Severity, { label: string; color: string }> = {
  critical: { label: 'CRITICAL', color: 'text-red-400' },
  medium:   { label: 'MEDIUM',   color: 'text-amber-400' },
  low:      { label: 'LOW',      color: 'text-yellow-500' },
  none:     { label: 'NONE',     color: 'text-slate-400' },
};

export const ClassificationBadge: React.FC<Props> = ({ classification, severity, confidence }) => {
  const cls = classificationConfig[classification];
  const sev = severityConfig[severity];

  return (
    <div className={`inline-flex flex-col gap-1 px-3 py-2 rounded-lg border ${cls.bg} ${cls.border}`}>
      <span className={`font-bold text-sm ${cls.text}`}>{cls.label}</span>
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-mono font-bold ${sev.color}`}>{sev.label}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400">{confidence}% confidence</span>
      </div>
    </div>
  );
};

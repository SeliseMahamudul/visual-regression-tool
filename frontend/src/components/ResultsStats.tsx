import React from 'react';

interface Props {
  total: number;
  bugCount: number;
  reviewCount: number;
  cleanCount: number;
}

/**
 * Non-interactive summary of the current run. Previously four bordered/shadowed
 * boxes that read as clickable cards but did nothing on click — replaced with a
 * bar chart so the affordance matches the behaviour.
 */
export const ResultsStats: React.FC<Props> = ({ total, bugCount, reviewCount, cleanCount }) => {
  const bars: { label: string; value: number; color: string }[] = [
    { label: 'Bugs Found', value: bugCount, color: '#dc2626' },
    { label: 'Needs Review', value: reviewCount, color: '#d97706' },
    { label: 'Clean', value: cleanCount, color: '#16a34a' },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-slate-600">Total Tested</span>
        <span className="text-lg font-bold text-slate-900">{total}</span>
      </div>
      <div className="space-y-3">
        {bars.map((bar) => {
          const pct = total > 0 ? (bar.value / total) * 100 : 0;
          return (
            <div key={bar.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-slate-500">{bar.label}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${pct}%`, backgroundColor: bar.color }}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-xs font-semibold text-slate-700">
                {bar.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import { UploadForm } from './UploadForm';
import { CompareFormData } from '../types';
import { Eye } from 'lucide-react';

interface Props {
  onSubmit: (data: CompareFormData) => void;
  loading: boolean;
  hasResults: boolean;
}

/**
 * The original upload UI, extracted from App.tsx UNCHANGED so live mode could
 * be added alongside it. Behaviour is identical — App still owns `results`,
 * the stats bar, and the result cards.
 */
export function UploadMode({ onSubmit, loading, hasResults }: Props) {
  return (
    <>
      <div className="lg:col-span-2">
        <div className="sticky top-24 bg-slate-900/60 border border-slate-700 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Compare Screenshots</h2>
          <p className="text-sm text-slate-400 mb-5">
            Upload before &amp; after screenshots. AI classifies changes and auto-files bugs.
          </p>
          <UploadForm onSubmit={onSubmit} loading={loading} />
        </div>
      </div>

      {!hasResults && (
        <div className="lg:col-span-3">
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-700 rounded-2xl">
            <Eye size={40} className="text-slate-600 mb-4" />
            <p className="text-slate-400 font-medium">No comparisons yet</p>
            <p className="text-sm text-slate-500 mt-1">Upload screenshots to get started</p>
          </div>
        </div>
      )}
    </>
  );
}

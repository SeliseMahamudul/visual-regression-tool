import { useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { UploadForm } from './components/UploadForm';
import { ResultCard } from './components/ResultCard';
import { compareScreenshots } from './api/client';
import { CompareFormData, TestResult } from './types';
import { Eye, Github, Zap } from 'lucide-react';

// Simple id shim — avoids pulling `uuid` in just for a client-side run id
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function App() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(false);

  const handleCompare = async (data: CompareFormData) => {
    if (!data.before || !data.after) return;
    setLoading(true);

    try {
      // A fresh run id per comparison. Sharing one id across the session made
      // every upload land in the same folder, so the diff of comparison #2
      // overwrote #1 and the screenshot routes (which resolve by run id) served
      // the wrong images for every card but the newest.
      const result = await compareScreenshots(data, generateId());
      setResults((prev) => [result, ...prev]);

      const { classification } = result;
      if (classification.classification === 'BUG') {
        toast.error(`🐛 Bug detected: ${classification.component} [${classification.severity}]`);
      } else if (classification.classification === 'NEEDS_REVIEW') {
        toast(`⚠️ Needs review: ${classification.component}`, { icon: '🔍' });
      } else {
        toast.success(`✅ ${classification.classification.replace('_', ' ')}: ${classification.component}`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Analysis failed. Check backend connection.');
    } finally {
      setLoading(false);
    }
  };

  const bugCount = results.filter((r) => r.classification.classification === 'BUG').length;
  const reviewCount = results.filter((r) => r.classification.classification === 'NEEDS_REVIEW').length;
  const cleanCount = results.filter(
    (r) => r.classification.classification === 'INTENTIONAL_CHANGE' || r.classification.classification === 'DYNAMIC_CONTENT'
  ).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' },
        }}
      />

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-violet-600 rounded-lg p-2">
              <Eye size={20} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-white">Visual Regression AI</h1>
              <p className="text-xs text-slate-400">Powered by Gemini Flash · Playwright · Node.js</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-white transition-colors"
            >
              <Github size={20} />
            </a>
            <div className="flex items-center gap-1.5 text-xs bg-green-900/30 text-green-400 border border-green-800 px-2.5 py-1.5 rounded-full">
              <Zap size={11} />
              AI Ready
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Stats bar */}
        {results.length > 0 && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Tested', value: results.length, color: 'text-slate-200' },
              { label: 'Bugs Found', value: bugCount, color: 'text-red-400' },
              { label: 'Needs Review', value: reviewCount, color: 'text-amber-400' },
              { label: 'Clean', value: cleanCount, color: 'text-green-400' },
            ].map((stat) => (
              <div key={stat.label} className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
                <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-slate-400 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Upload panel */}
          <div className="lg:col-span-2">
            <div className="sticky top-24 bg-slate-900/60 border border-slate-700 rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white mb-1">Compare Screenshots</h2>
              <p className="text-sm text-slate-400 mb-5">
                Upload before & after screenshots. AI classifies changes and auto-files bugs.
              </p>
              <UploadForm onSubmit={handleCompare} loading={loading} />
            </div>
          </div>

          {/* Results panel */}
          <div className="lg:col-span-3 space-y-4">
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-700 rounded-2xl">
                <Eye size={40} className="text-slate-600 mb-4" />
                <p className="text-slate-400 font-medium">No comparisons yet</p>
                <p className="text-sm text-slate-500 mt-1">Upload screenshots to get started</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-200">
                    Results <span className="text-slate-400 font-normal">({results.length})</span>
                  </h2>
                  <button
                    onClick={() => setResults([])}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                {results.map((result) => (
                  <ResultCard key={result.id} result={result} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* How it works */}
        {results.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4">
            {[
              { step: '01', title: 'Upload', desc: 'Drop before & after screenshots of any UI' },
              { step: '02', title: 'Diff', desc: 'Pixelmatch highlights changed pixels instantly' },
              { step: '03', title: 'AI Classify', desc: 'Gemini Flash determines if it\'s a bug or intentional' },
              { step: '04', title: 'Auto-File', desc: 'Bugs go straight to Jira & GitHub Issues' },
            ].map((item) => (
              <div key={item.step} className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                <div className="text-violet-500 font-mono text-xs font-bold mb-2">{item.step}</div>
                <div className="text-white font-semibold text-sm mb-1">{item.title}</div>
                <div className="text-slate-400 text-xs leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

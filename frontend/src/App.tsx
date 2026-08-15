import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { UploadMode } from './components/UploadMode';
import { ResultCard } from './components/ResultCard';
import { LiveCompare } from './components/live/LiveCompare';
import { compareScreenshots, getIntegrationStatus } from './api/client';
import { CompareFormData, TestResult } from './types';
import { Search, Github, Zap, ZapOff, MonitorPlay, ArrowLeft } from 'lucide-react';

type Tab = 'dashboard' | 'compare-live';

// Simple id shim — avoids pulling `uuid` in just for a client-side run id
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type Mode = 'upload' | 'live';

export default function App() {
  const [mode, setMode] = useState<Mode>('upload');
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  // FR-44: reflect the real Gemini health, not a hardcoded badge.
  useEffect(() => {
    getIntegrationStatus()
      .then((status) => setAiReady(!!status.gemini))
      .catch(() => setAiReady(false));
  }, []);

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

  // Live captures append to the SAME array and render through the existing,
  // unmodified ResultCard (FR-69).
  const handleLiveResult = useCallback((result: TestResult) => {
    setResults((prev) => [result, ...prev]);
  }, []);

  const bugCount = results.filter((r) => r.classification.classification === 'BUG').length;
  const reviewCount = results.filter((r) => r.classification.classification === 'NEEDS_REVIEW').length;
  const cleanCount = results.filter(
    (r) => r.classification.classification === 'INTENTIONAL_CHANGE' || r.classification.classification === 'DYNAMIC_CONTENT'
  ).length;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'compare-live', label: 'Compare Live' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#0f172a', color: '#f1f5f9', border: '1px solid #1e293b' },
        }}
      />

      {/* Top nav — logo, nav links, and actions in one bar (browserstack.com/live style) */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="bg-blue-900 rounded-md p-1.5">
                <Search size={18} className="text-white" />
              </div>
              <span className="font-bold text-base text-slate-900 tracking-tight">Visual Regression AI</span>
            </div>

            {/* Nav links */}
            <nav className="hidden sm:flex items-center h-16">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`h-16 flex items-center px-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-900 text-blue-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Right-side actions */}
          <div className="flex items-center gap-3">
            <div
              className={`hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border ${
                aiReady
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}
            >
              {aiReady ? <Zap size={11} /> : <ZapOff size={11} />}
              {aiReady === null ? 'Checking AI…' : aiReady ? 'AI Ready' : 'AI Unavailable'}
            </div>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-900 transition-colors"
            >
              <Github size={20} />
            </a>
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="sm:hidden flex items-center border-t border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-900 text-blue-900'
                  : 'border-transparent text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === 'dashboard' ? (
        <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
          {/* Back button — shown once a test has been run */}
          {results.length > 0 && (
            <button
              onClick={() => setResults([])}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft size={16} />
              Back to Dashboard
            </button>
          )}

          {/* Stats bar */}
          {results.length > 0 && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Total Tested', value: results.length, color: 'text-slate-900' },
                { label: 'Bugs Found', value: bugCount, color: 'text-red-600' },
                { label: 'Needs Review', value: reviewCount, color: 'text-amber-600' },
                { label: 'Clean', value: cleanCount, color: 'text-green-600' },
              ].map((stat) => (
                <div key={stat.label} className="bg-white border border-slate-200 rounded-xl p-4 text-center shadow-sm">
                  <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-slate-500 mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Upload panel */}
            <div className="lg:col-span-2">
              <div className="sticky top-24 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Compare Screenshots</h2>
                <p className="text-sm text-slate-500 mb-5">
                  Upload before & after screenshots. AI classifies changes and auto-files bugs.
                </p>
                <UploadForm onSubmit={handleCompare} loading={loading} />
              </div>
            </div>

            {/* Results panel */}
            <div className="lg:col-span-3 space-y-4">
              {results.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-300 rounded-2xl bg-white">
                  <Search size={40} className="text-slate-300 mb-4" />
                  <p className="text-slate-600 font-medium">No comparisons yet</p>
                  <p className="text-sm text-slate-400 mt-1">Upload screenshots to get started</p>
                </div>
              ) : (
                <>
                  <h2 className="font-semibold text-slate-800">
                    Results <span className="text-slate-400 font-normal">({results.length})</span>
                  </h2>
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
                <div key={item.step} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="text-blue-900 font-mono text-xs font-bold mb-2">{item.step}</div>
                  <div className="text-slate-900 font-semibold text-sm mb-1">{item.title}</div>
                  <div className="text-slate-500 text-xs leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          )}
        </main>
      ) : (
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col items-center justify-center h-[50vh] border-2 border-dashed border-slate-300 rounded-2xl bg-white text-center px-6">
            <MonitorPlay size={40} className="text-slate-300 mb-4" />
            <h2 className="text-slate-900 font-semibold text-lg mb-1">Compare Live</h2>
            <p className="text-slate-500 text-sm max-w-md">
              Side-by-side live comparison of two environments (FR-63) is coming soon — enter two
              URLs, interact with each independently, then capture and classify both panes with
              the existing pipeline.
            </p>
          </div>
        </main>
      )}

      <footer className="border-t border-slate-200 bg-white mt-8">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <span>© {new Date().getFullYear()} Mahamudul Islam. All rights reserved.</span>
          <span>Last updated: {new Date().toLocaleString()}</span>
        </div>
      </footer>
    </div>
  );
}

function ResultsHeader({ count, onClear }: { count: number; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-semibold text-slate-200">
        Results <span className="text-slate-400 font-normal">({count})</span>
      </h2>
      <button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
        Clear all
      </button>
    </div>
  );
}

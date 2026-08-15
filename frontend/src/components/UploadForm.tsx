import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Settings } from 'lucide-react';
import { CompareFormData } from '../types';

interface DropZoneProps {
  label: string;
  file: File | null;
  onDrop: (file: File) => void;
  onClear: () => void;
}

const DropZone: React.FC<DropZoneProps> = ({ label, file, onDrop, onClear }) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
    onDrop: (files) => files[0] && onDrop(files[0]),
  });

  return (
    <div>
      <p className="text-sm font-medium text-slate-300 mb-2">{label}</p>
      {file ? (
        <div className="relative rounded-lg border border-violet-500/50 bg-violet-900/10 overflow-hidden">
          <img
            src={URL.createObjectURL(file)}
            alt={label}
            className="w-full h-40 object-top object-cover"
          />
          <button
            onClick={onClear}
            className="absolute top-2 right-2 bg-slate-900/80 rounded-full p-1 hover:bg-red-900 transition-colors"
          >
            <X size={14} className="text-white" />
          </button>
          <div className="px-3 py-1.5 bg-slate-900/70">
            <p className="text-xs text-slate-300 truncate">{file.name}</p>
          </div>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={`h-40 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-violet-500 bg-violet-900/20'
              : 'border-slate-600 hover:border-violet-500/70 bg-slate-800/40'
          }`}
        >
          <input {...getInputProps()} />
          <Upload size={24} className="text-slate-500 mb-2" />
          <p className="text-sm text-slate-400">Drop screenshot here</p>
          <p className="text-xs text-slate-500 mt-1">PNG, JPG, WebP</p>
        </div>
      )}
    </div>
  );
};

interface Props {
  onSubmit: (data: CompareFormData) => void;
  loading: boolean;
}

export const UploadForm: React.FC<Props> = ({ onSubmit, loading }) => {
  const [form, setForm] = useState<CompareFormData>({
    before: null,
    after: null,
    page_name: '',
    auto_file_bugs: false,
    jira_project_key: '',
    github_owner: '',
    github_repo: '',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canSubmit = form.before && form.after && !loading;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Page name */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Page / Component Name
        </label>
        <input
          type="text"
          placeholder="e.g. Home Page, Checkout Flow, Nav Bar"
          value={form.page_name}
          onChange={(e) => setForm({ ...form, page_name: e.target.value })}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-sm"
        />
      </div>

      {/* Screenshot uploads */}
      <div className="grid grid-cols-2 gap-4">
        <DropZone
          label="Before Screenshot (Baseline)"
          file={form.before}
          onDrop={(f) => setForm({ ...form, before: f })}
          onClear={() => setForm({ ...form, before: null })}
        />
        <DropZone
          label="After Screenshot (New Build)"
          file={form.after}
          onDrop={(f) => setForm({ ...form, after: f })}
          onClear={() => setForm({ ...form, after: null })}
        />
      </div>

      {/* Advanced / integrations */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <Settings size={15} />
          {showAdvanced ? 'Hide' : 'Show'} Integration Settings
        </button>

        {showAdvanced && (
          <div className="mt-3 p-4 bg-slate-800/50 rounded-lg border border-slate-700 space-y-4">
            {/* Auto-file bugs toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setForm({ ...form, auto_file_bugs: !form.auto_file_bugs })}
                className={`w-10 h-6 rounded-full transition-colors relative ${
                  form.auto_file_bugs ? 'bg-violet-600' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    form.auto_file_bugs ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </div>
              <span className="text-sm text-slate-300">Auto-file bugs to Jira & GitHub</span>
            </label>

            {form.auto_file_bugs && (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Jira Project Key</label>
                  <input
                    type="text"
                    placeholder="e.g. QA, PROJ"
                    value={form.jira_project_key}
                    onChange={(e) => setForm({ ...form, jira_project_key: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">GitHub Owner</label>
                    <input
                      type="text"
                      placeholder="your-org"
                      value={form.github_owner}
                      onChange={(e) => setForm({ ...form, github_owner: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">GitHub Repo</label>
                    <input
                      type="text"
                      placeholder="your-repo"
                      value={form.github_repo}
                      onChange={(e) => setForm({ ...form, github_repo: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={`w-full py-3 rounded-lg font-semibold text-sm transition-all ${
          canSubmit
            ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/30'
            : 'bg-slate-700 text-slate-500 cursor-not-allowed'
        }`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Running AI Analysis...
          </span>
        ) : (
          '🔍 Run Visual Regression Analysis'
        )}
      </button>
    </form>
  );
};

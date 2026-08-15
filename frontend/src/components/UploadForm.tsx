import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Settings } from 'lucide-react';
import { CompareFormData } from '../types';
import { ExpectationChat } from './ExpectationChat';

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
      <p className="text-sm font-medium text-slate-700 mb-2">{label}</p>
      {file ? (
        <div className="relative rounded-lg border border-blue-300 bg-blue-50 overflow-hidden">
          <img
            src={URL.createObjectURL(file)}
            alt={label}
            className="w-full h-40 object-top object-cover"
          />
          <button
            onClick={onClear}
            className="absolute top-2 right-2 bg-white/90 rounded-full p-1 hover:bg-red-100 transition-colors shadow-sm"
          >
            <X size={14} className="text-slate-700" />
          </button>
          <div className="px-3 py-1.5 bg-white/90">
            <p className="text-xs text-slate-600 truncate">{file.name}</p>
          </div>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={`h-40 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-blue-900 bg-blue-50'
              : 'border-slate-300 hover:border-blue-400 bg-slate-50'
          }`}
        >
          <input {...getInputProps()} />
          <Upload size={24} className="text-slate-400 mb-2" />
          <p className="text-sm text-slate-500">Drop screenshot here</p>
          <p className="text-xs text-slate-400 mt-1">PNG, JPG, WebP</p>
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
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Page / Component Name
        </label>
        <input
          type="text"
          placeholder="e.g. Home Page, Checkout Flow, Nav Bar"
          value={form.page_name}
          onChange={(e) => setForm({ ...form, page_name: e.target.value })}
          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-900 text-sm"
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

      {/* FR-52: expectation chat. Sits below the drop zones so it is easy to
          find but never blocks the fast path — canSubmit is unchanged, because
          expectations are always optional. */}
      <ExpectationChat
        rules={form.expectations}
        onRulesChange={(expectations) => setForm({ ...form, expectations })}
        disabled={loading}
      />

      {/* Advanced / integrations */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <Settings size={15} />
          {showAdvanced ? 'Hide' : 'Show'} Integration Settings
        </button>

        {showAdvanced && (
          <div className="mt-3 p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-4">
            {/* Auto-file bugs toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setForm({ ...form, auto_file_bugs: !form.auto_file_bugs })}
                className={`w-10 h-6 rounded-full transition-colors relative ${
                  form.auto_file_bugs ? 'bg-blue-900' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    form.auto_file_bugs ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </div>
              <span className="text-sm text-slate-700">Auto-file bugs to Jira & GitHub</span>
            </label>

            {form.auto_file_bugs && (
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Jira Project Key</label>
                  <input
                    type="text"
                    placeholder="e.g. QA, PROJ"
                    value={form.jira_project_key}
                    onChange={(e) => setForm({ ...form, jira_project_key: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-blue-900"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">GitHub Owner</label>
                    <input
                      type="text"
                      placeholder="your-org"
                      value={form.github_owner}
                      onChange={(e) => setForm({ ...form, github_owner: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-blue-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">GitHub Repo</label>
                    <input
                      type="text"
                      placeholder="your-repo"
                      value={form.github_repo}
                      onChange={(e) => setForm({ ...form, github_repo: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded px-3 py-2 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-blue-900"
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
            ? 'bg-blue-900 hover:bg-blue-800 text-white shadow-sm'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
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

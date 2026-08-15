import React, { useState } from 'react';
import { MessageSquare, Send, X, Trash2, Check, Loader2, Bot } from 'lucide-react';
import { ChatMessage, ExpectationRules } from '../types';
import { chat } from '../api/client';

/**
 * FR-52 / FR-54: the expectation chat panel. The engineer describes in plain
 * English what they meant to change; the backend extracts structured rules;
 * those rules are shown back here and applied only when confirmed.
 *
 * Local state only. Messages are never lifted into App.tsx and never persisted
 * — expectations are per-comparison by design, so the panel resets after a run.
 *
 * Styling follows the app's light theme (UploadForm/ResultCard/
 * ClassificationBadge): white cards, slate text, blue-900 primary. The three
 * rule groups reuse ClassificationBadge's semantic palette — green for
 * intentional, red for bug, blue for dynamic content — so the colours already
 * mean the right thing to a returning user.
 */

interface Props {
  rules: ExpectationRules | undefined;
  onRulesChange: (rules: ExpectationRules | undefined) => void;
  disabled: boolean;
}

type RuleGroup = 'expected' | 'unexpected' | 'ignore';

const GROUPS: { key: RuleGroup; label: string; chip: string }[] = [
  {
    key: 'expected',
    label: 'Expected — treat as intentional',
    chip: 'bg-green-50 text-green-700 border-green-200',
  },
  {
    key: 'unexpected',
    label: 'Must not happen — treat as a bug',
    chip: 'bg-red-50 text-red-700 border-red-200',
  },
  {
    key: 'ignore',
    label: 'Dynamic — not meaningful',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
  },
];

const EXAMPLES = [
  'We intentionally moved the search bar into the header. The sidebar width must not change.',
  'The dashboard timestamps update constantly — ignore them. The nav must never disappear.',
];

function isEmpty(r: ExpectationRules | undefined): boolean {
  return !r || (!r.expected.length && !r.unexpected.length && !r.ignore.length);
}

export const ExpectationChat: React.FC<Props> = ({ rules, onRulesChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<ExpectationRules | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await chat(next);
      setMessages([...next, { role: 'assistant', content: res.reply }]);
      setDraft(res.rules);
    } catch (err) {
      const detail =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err as Error)?.message ??
        'Chat request failed';
      setError(detail);
    } finally {
      setSending(false);
    }
  };

  /** FR-54: extraction gets things wrong; correcting it must not mean retyping. */
  const removeRule = (group: RuleGroup, index: number) => {
    if (!draft) return;
    setDraft({ ...draft, [group]: draft[group].filter((_, i) => i !== index) });
  };

  const apply = () => {
    if (!draft) return;
    onRulesChange(isEmpty(draft) && !draft.raw ? undefined : draft);
    setOpen(false);
  };

  const clearApplied = () => {
    onRulesChange(undefined);
    setDraft(undefined);
    setMessages([]);
    setInput('');
    setError(null);
  };

  // ─── Collapsed: applied-rules chip ────────────────────────────────────────
  if (rules && !open) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <MessageSquare size={16} className="mt-0.5 shrink-0 text-blue-900" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">Expectations applied</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {rules.summary || `${rules.expected.length + rules.unexpected.length + rules.ignore.length} rule(s)`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GROUPS.flatMap(({ key, chip }) =>
              rules[key].map((r, i) => (
                <span
                  key={`${key}-${i}`}
                  className={`rounded border px-2 py-0.5 text-xs ${chip}`}
                >
                  {r}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={disabled}
            className="rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={clearApplied}
            disabled={disabled}
            aria-label="Clear expectations"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  // ─── Collapsed: entry point ───────────────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-slate-50 disabled:opacity-50"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50">
          <Bot size={15} className="animate-bounce text-blue-900" />
        </span>
        <span className="text-sm font-medium text-slate-900">
          Tell the AI what you expected to change
        </span>
        <span className="ml-auto text-xs text-slate-400">optional</span>
      </button>
    );
  }

  // ─── Expanded ─────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <MessageSquare size={16} className="text-blue-900" />
        <p className="text-sm font-semibold text-slate-900">Expected changes</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close expectation chat"
          className="ml-auto rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3 p-4">
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              Describe what you changed on purpose and what must not change. The AI uses this to
              judge the diff — it still reports every change it finds.
            </p>
            <div className="flex flex-col gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => void send(ex)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-slate-800"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation */}
        {messages.length > 0 && (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'ml-auto bg-blue-900 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={12} className="animate-spin" />
                Extracting rules…
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {/* Extracted rules, for confirmation (FR-54) */}
        {draft && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            {GROUPS.map(({ key, label, chip }) =>
              draft[key].length ? (
                <div key={key}>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {draft[key].map((rule, i) => (
                      <span
                        key={`${key}-${i}`}
                        className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${chip}`}
                      >
                        {rule}
                        <button
                          type="button"
                          onClick={() => removeRule(key, i)}
                          aria-label={`Remove rule: ${rule}`}
                          className="opacity-60 transition-opacity hover:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null
            )}

            {isEmpty(draft) && (
              <p className="text-xs text-slate-500">
                No rules were extracted from that. Try naming the component and what you did to it.
              </p>
            )}

            <button
              type="button"
              onClick={apply}
              disabled={isEmpty(draft)}
              className={`flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-blue-900 ${
                isEmpty(draft)
                  ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                  : 'bg-blue-900 text-white shadow-sm hover:bg-blue-800'
              }`}
            >
              <Check size={14} />
              Apply to this comparison
            </button>
          </div>
        )}

        {/* Composer */}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="e.g. We restyled the header dark on purpose. The logo must not move."
            className="min-h-[3rem] flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-900 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={!input.trim() || sending}
            aria-label="Send"
            className={`rounded-lg p-2.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-900 ${
              !input.trim() || sending
                ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                : 'bg-blue-900 text-white shadow-sm hover:bg-blue-800'
            }`}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};

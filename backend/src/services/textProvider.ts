/**
 * FR-57 / FR-58: The chat text model is swappable by changing this one file
 * (or, at runtime, the CHAT_PROVIDER env var). Deliberately a SEPARATE provider
 * from visionProvider.ts: the Gemini free tier is 15 RPM / 1,500 RPD and chat
 * is far chattier than classification. Chat traffic must never starve the
 * classification pipeline, which is the feature people actually depend on.
 *
 * Mirrors visionProvider.ts's structure on purpose — anyone who understands
 * that file understands this one on sight.
 */
import axios from 'axios';
import { ChatMessage, ExpectationRules } from '../types';
import { withRetry } from './retry';

export interface TextRequest {
  messages: ChatMessage[];
  systemPrompt: string;
}

/** A provider takes the conversation and returns the raw model text. */
export type TextProvider = (req: TextRequest) => Promise<string>;

// SEC-12: every user-supplied string that reaches a model prompt is capped.
// An unbounded field concatenated into every prompt is both an injection
// surface and a token bill.
export const MAX_RULES_PER_GROUP = 20;
export const MAX_RULE_LENGTH = 500;
export const MAX_RAW_LENGTH = 4000;
export const MAX_SUMMARY_LENGTH = 500;

// ─── Groq (free tier, OpenAI-compatible) ────────────────────────────────────

const groqProvider: TextProvider = async (req) => {
  // Read env inside the function, never at module load (CLAUDE.md gotcha #1).
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not set. Add it to backend/.env (free key: https://console.groq.com/keys), or set CHAT_PROVIDER=mock.'
    );
  }
  // Pinned, not a "-latest" alias: CLAUDE.md gotcha #5 — Google retired two
  // model names out from under this repo already, and Groq deprecates on a
  // published schedule too. Diagnose a 404 with:
  //   curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.1,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  return String(response.data?.choices?.[0]?.message?.content ?? '');
};

// ─── Ollama (fully local, no key, no third party) ───────────────────────────

const ollamaProvider: TextProvider = async (req) => {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';

  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: false,
      format: 'json',
      options: { temperature: 0.1 },
    },
    { timeout: 30000 }
  );

  return String(response.data?.message?.content ?? '');
};

// ─── Offline / demo provider ────────────────────────────────────────────────
// FR-59: deterministic sentence classification, no LLM, no network. Crude on
// purpose — it makes the entire feature and its test suite runnable with no API
// key, exactly as VISION_PROVIDER=mock does today. Its summary says so
// explicitly so it can never be mistaken for a real model's extraction.

const UNEXPECTED_MARKERS = [
  'must not',
  "shouldn't",
  'should not',
  'unexpected',
  'broken',
  'regression',
  'not',
  'never',
];
const IGNORE_MARKERS = [
  'ignore',
  'dynamic',
  'timestamp',
  'avatar',
  'random',
  'changes every',
];

const mockProvider: TextProvider = async (req) => {
  const raw = req.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

  const expected: string[] = [];
  const unexpected: string[] = [];
  const ignore: string[] = [];

  for (const clause of raw.split(/[.;\n]+/)) {
    const trimmed = clause.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    // Order matters: "ignore the timestamp, it is not stable" is an ignore
    // rule, so the dynamic-content markers are tested first.
    if (IGNORE_MARKERS.some((m) => lower.includes(m))) {
      ignore.push(trimmed);
    } else if (UNEXPECTED_MARKERS.some((m) => matchesWord(lower, m))) {
      unexpected.push(trimmed);
    } else {
      expected.push(trimmed);
    }
  }

  return JSON.stringify({
    expected,
    unexpected,
    ignore,
    summary: `Offline rule extraction: ${expected.length} expected, ${unexpected.length} unexpected, ${ignore.length} ignored (no chat model was called — set CHAT_PROVIDER=groq or ollama for real extraction).`,
    reply: `Got it — I read ${expected.length} expected change(s), ${unexpected.length} thing(s) that must not happen, and ${ignore.length} dynamic region(s). Review them below, then apply them to this comparison.`,
  });
};

/**
 * Whole-word match so "another" does not trip the "not" marker. Multi-word
 * markers ("must not") are matched as a phrase with word boundaries at each end.
 */
function matchesWord(haystack: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`).test(haystack);
}

const PROVIDERS: Record<string, TextProvider> = {
  groq: groqProvider,
  ollama: ollamaProvider,
  mock: mockProvider,
};

/**
 * FR-58 / FR-59. Default is `mock`, NOT `groq` — this deliberately differs from
 * visionProvider.getProvider(), which defaults to `gemini`. Vision is the core
 * feature and a missing key there is a real error worth surfacing; chat is
 * additive, and a fresh clone with no GROQ_API_KEY must not see the chat panel
 * throw.
 */
export function getTextProvider(): TextProvider {
  const name = (process.env.CHAT_PROVIDER || 'mock').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown CHAT_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return provider;
}

/**
 * Calls the configured provider with the shared retry policy (NFR-06) and maps
 * upstream failures to messages a QA engineer can act on (NFR-09).
 */
export async function runTextProvider(req: TextRequest): Promise<string> {
  const provider = getTextProvider();

  return withRetry(() => provider(req), {
    onRetry: (attempt, delayMs, error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      console.warn(
        `[chat] attempt ${attempt} failed${status ? ` (HTTP ${status})` : ''}; retrying in ${Math.round(
          delayMs
        )}ms`
      );
    },
  }).catch((error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const code = (error as { code?: string })?.code;
    const message = (error as Error)?.message ?? 'unknown error';

    if (status === 401 || status === 403) {
      throw new Error(
        `Chat provider rejected the credentials (HTTP ${status}). Check GROQ_API_KEY in backend/.env.`
      );
    }
    if (status === 429) {
      throw new Error(
        'Chat provider rate limit exceeded (429) after retries. Wait a moment, or set CHAT_PROVIDER=ollama / mock.'
      );
    }
    if (status === 404) {
      throw new Error(
        'Chat provider returned 404 — the configured model was not found. Set GROQ_MODEL (or OLLAMA_MODEL) to a model your key can serve.'
      );
    }
    if (code === 'ECONNREFUSED') {
      throw new Error(
        `Could not reach the chat provider (${code}). If CHAT_PROVIDER=ollama, is \`ollama serve\` running?`
      );
    }
    throw new Error(`Chat extraction failed: ${message}`);
  });
}

// ─── Validation ─────────────────────────────────────────────────────────────

function coerceList(value: unknown): string[] {
  // SEC-12: cap the count and the length of every entry.
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v : String(v ?? '')))
    .map((v) => v.trim().slice(0, MAX_RULE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_RULES_PER_GROUP);
}

/**
 * FR-62 / SEC-12: normalise an arbitrary, possibly hostile value into
 * ExpectationRules. **Never throws.** Returns `undefined` when the input
 * carries nothing usable, so a malformed payload degrades to "no expectations"
 * rather than failing a comparison the user has already paid quota for.
 *
 * `value` is `unknown` deliberately: this is the trust boundary, and typing it
 * as anything narrower would be a lie about what actually arrives here.
 */
export function validateExpectationRules(value: unknown): ExpectationRules | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;

  const expected = coerceList(obj.expected);
  const unexpected = coerceList(obj.unexpected);
  const ignore = coerceList(obj.ignore);
  const raw =
    typeof obj.raw === 'string' ? obj.raw.trim().slice(0, MAX_RAW_LENGTH) : '';
  const summary =
    typeof obj.summary === 'string'
      ? obj.summary.trim().slice(0, MAX_SUMMARY_LENGTH)
      : '';

  // Nothing the vision model could act on — treat as absent rather than
  // threading an empty shell through the pipeline.
  if (!expected.length && !unexpected.length && !ignore.length && !raw) {
    return undefined;
  }

  return { expected, unexpected, ignore, summary, raw };
}

export { groqProvider, ollamaProvider, mockProvider };

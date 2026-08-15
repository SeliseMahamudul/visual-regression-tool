import { AIClassification, ClassificationResult, ExpectationRules, Severity } from '../types';
import { getProvider, VisionRequest } from './visionProvider';
import { withRetry, isRetryable } from './retry';
import { extractJsonObject } from './jsonFromModel';

// The prompt itself lives in visionPrompt.ts (NFR-14) and the transport in
// visionProvider.ts (FR-22 / NFR-15). This module owns retry policy (FR-21),
// response parsing, and validation of the model's JSON.

const VALID_CLASSIFICATIONS: ClassificationResult[] = [
  'BUG',
  'INTENTIONAL_CHANGE',
  'DYNAMIC_CONTENT',
  'NEEDS_REVIEW',
];

const VALID_SEVERITIES: Severity[] = ['critical', 'medium', 'low', 'none'];

/**
 * Models occasionally wrap JSON in markdown fences or add a preamble despite
 * being told not to. The fence-stripping/fallback logic now lives in
 * jsonFromModel.ts so the chat extraction route shares it (§4.2 of
 * CHATBOT_IMPLEMENTATION_PLAN) — this function's behaviour is unchanged.
 */
export function parseClassificationResponse(rawText: string): Omit<AIClassification, 'diff_percentage'> {
  const parsed = extractJsonObject(rawText);

  const classification = parsed.classification as ClassificationResult;
  const severity = parsed.severity as Severity;

  // FR-16 / FR-17: the contract promises one of a fixed set of values. An
  // out-of-contract value downstream would silently skip bug filing, so
  // normalise it to NEEDS_REVIEW rather than passing it through.
  return {
    classification: VALID_CLASSIFICATIONS.includes(classification)
      ? classification
      : 'NEEDS_REVIEW',
    severity: VALID_SEVERITIES.includes(severity) ? severity : 'none',
    component: String(parsed.component ?? 'Unknown'),
    explanation: String(parsed.explanation ?? 'No explanation returned by the model.'),
    recommended_action: String(
      parsed.recommended_action ?? 'Review the diff image manually.'
    ),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence ?? 0))),
  };
}

export async function classifyWithGemini(
  beforePath: string,
  afterPath: string,
  diffPath: string,
  diffPercentage: number,
  /** FR-55: per-comparison expectation rules, optional and always additive. */
  expectations?: ExpectationRules
): Promise<AIClassification> {
  const provider = getProvider();
  const request: VisionRequest = {
    beforePath,
    afterPath,
    diffPath,
    diffPercentage,
    expectations,
  };

  const rawText = await withRetry(() => provider(request), {
    onRetry: (attempt, delayMs, error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      console.warn(
        `[ai] attempt ${attempt} failed${status ? ` (HTTP ${status})` : ''}; retrying in ${Math.round(
          delayMs
        )}ms`
      );
    },
  }).catch((error: unknown) => {
    // NFR-09: surface a message a QA engineer can act on, not a raw stack.
    const status = (error as { response?: { status?: number } })?.response?.status;
    const message = (error as Error)?.message ?? 'unknown error';
    // NFR-09: include the provider's own error text. Without it a wrong model
    // name is indistinguishable from a wrong URL — both surface as a bare 404.
    const upstream = (error as { response?: { data?: unknown } })?.response?.data;
    const detail =
      typeof upstream === 'object' && upstream !== null
        ? ((upstream as { error?: { message?: string } }).error?.message ?? '')
        : '';

    if (status === 404) {
      throw new Error(
        `AI provider returned 404 — the configured model was not found. ${detail} ` +
          'Set GEMINI_MODEL in backend/.env to a model your key can serve.'
      );
    }
    if (status === 429) {
      throw new Error(
        'AI provider rate limit exceeded (429) after retries. The Gemini free tier allows 15 requests/minute — space out runs or upgrade the tier.'
      );
    }
    if (status === 401 || status === 403) {
      throw new Error(
        'AI provider rejected the credentials (HTTP ' + status + '). Check GEMINI_API_KEY in backend/.env.'
      );
    }
    throw new Error(
      `AI classification failed${isRetryable(error) ? ' after retries' : ''}: ${message}${
        detail ? ` — ${detail}` : ''
      }`
    );
  });

  return {
    ...parseClassificationResponse(rawText),
    diff_percentage: diffPercentage,
  };
}

/** Alias that does not name a specific vendor (FR-22). */
export const classifyVisualChange = classifyWithGemini;

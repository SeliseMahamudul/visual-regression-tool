/**
 * NFR-06 / FR-21: exponential backoff for transient upstream failures.
 * Retries 429 (rate limit — the Gemini free tier is 15 RPM) and 5xx, plus
 * network-level errors with no HTTP response. 4xx other than 429 are caller
 * errors and fail immediately — retrying a bad API key just wastes 30 seconds.
 */
import axios from 'axios';

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests so they don't actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  // No response at all => network/timeout failure, worth retrying.
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = Number(process.env.AI_MAX_RETRIES ?? 3),
    baseDelayMs = Number(process.env.AI_RETRY_BASE_MS ?? 1000),
    maxDelayMs = 30000,
    sleep = defaultSleep,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === retries || !isRetryable(error)) break;

      // Honour Retry-After when the server sends one, else exponential backoff
      // with jitter so parallel page captures don't retry in lockstep.
      const retryAfter = axios.isAxiosError(error)
        ? Number(error.response?.headers?.['retry-after'])
        : NaN;

      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = Math.random() * baseDelayMs;
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : backoff + jitter;

      onRetry?.(attempt + 1, delayMs, error);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

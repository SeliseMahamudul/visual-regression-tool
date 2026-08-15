/**
 * FR-22 / NFR-15: The vision model is swappable by changing this one file
 * (or, at runtime, the VISION_PROVIDER env var). Providers only differ in how
 * they transport the prompt + images; the prompt itself lives in visionPrompt.ts
 * and the retry policy lives in retry.ts, so both are shared by every provider.
 */
import axios from 'axios';
import * as fs from 'fs';
import { AIClassification } from '../types';
import { CLASSIFICATION_PROMPT, contextLine } from './visionPrompt';
import { withRetry } from './retry';

export interface VisionRequest {
  beforePath: string;
  afterPath: string;
  diffPath: string;
  diffPercentage: number;
}

/** A provider takes the three images and returns the raw model text. */
export type VisionProvider = (req: VisionRequest) => Promise<string>;

function imageToBase64(imagePath: string): string {
  return fs.readFileSync(imagePath).toString('base64');
}

function getMimeType(imagePath: string): string {
  const ext = imagePath.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  return mimeTypes[ext || 'png'] || 'image/png';
}

// ─── Google Gemini 2.0 Flash ────────────────────────────────────────────────

const geminiProvider: VisionProvider = async (req) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to backend/.env');
  }
  // REQUIREMENTS.md §7.1 specifies gemini-2.0-flash. That model — and 2.5-flash
  // after it — are no longer served to new API keys and return 404. 3.6-flash is
  // the current free-tier vision model. Pinned rather than using the
  // "gemini-flash-latest" alias so classifications stay reproducible across runs;
  // override with GEMINI_MODEL when moving to a newer model.
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const inline = (p: string) => ({
    inline_data: { mime_type: getMimeType(p), data: imageToBase64(p) },
  });

  const body = {
    contents: [
      {
        parts: [
          { text: CLASSIFICATION_PROMPT },
          inline(req.beforePath),
          inline(req.afterPath),
          inline(req.diffPath),
          { text: contextLine(req.diffPercentage) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      // Gemini 3.x spends "thinking" tokens from this same budget, so the
      // original 500 truncated the JSON mid-object. 2048 leaves room for both.
      maxOutputTokens: 2048,
      // Ask the API itself to guarantee JSON rather than relying on the prompt
      // and stripping markdown fences after the fact.
      responseMimeType: 'application/json',
    },
  };

  const response = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  const candidate = response.data?.candidates?.[0];

  // A truncated response is a silent corruption otherwise: the JSON parse fails
  // with a confusing message instead of naming the real cause.
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error(
      'Vision model hit the output token limit before completing its JSON response. Raise maxOutputTokens.'
    );
  }

  // Multi-part responses (thinking + answer) need every text part joined; taking
  // parts[0] alone can yield an empty or partial string.
  const parts = candidate?.content?.parts ?? [];
  return parts
    .filter((p: { text?: string }) => typeof p.text === 'string')
    .map((p: { text: string }) => p.text)
    .join('');
};

// ─── Offline / demo provider ────────────────────────────────────────────────
// Deterministic heuristic classifier driven purely by the pixel diff. Used for
// local demos and CI smoke runs where no API key is available. It never calls
// the network, so it can never be mistaken for a real AI verdict — its
// explanations say so explicitly.

const mockProvider: VisionProvider = async (req) => {
  const pct = req.diffPercentage;

  let classification: string;
  let severity: string;
  if (pct === 0) {
    classification = 'DYNAMIC_CONTENT';
    severity = 'none';
  } else if (pct < 0.5) {
    classification = 'DYNAMIC_CONTENT';
    severity = 'low';
  } else if (pct < 5) {
    classification = 'NEEDS_REVIEW';
    severity = 'medium';
  } else {
    classification = 'BUG';
    severity = 'critical';
  }

  return JSON.stringify({
    classification,
    severity,
    component: 'Unknown (offline provider)',
    explanation: `Offline heuristic provider: ${pct.toFixed(
      2
    )}% of pixels changed. No vision model was called — set VISION_PROVIDER=gemini and GEMINI_API_KEY for real AI classification.`,
    recommended_action:
      'Review the diff image manually, or configure a vision provider for an AI verdict.',
    confidence: 50,
  });
};

const PROVIDERS: Record<string, VisionProvider> = {
  gemini: geminiProvider,
  mock: mockProvider,
};

export function getProvider(): VisionProvider {
  const name = (process.env.VISION_PROVIDER || 'gemini').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown VISION_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return provider;
}

export { geminiProvider, mockProvider, withRetry };

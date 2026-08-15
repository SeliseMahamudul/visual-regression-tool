/**
 * Shared tolerant JSON extraction for model responses.
 *
 * Both the vision classifier (aiClassification.ts) and the chat extraction
 * route (routes/chat.ts) get JSON back from an LLM, and both hit the same two
 * failure modes: markdown fences the model was told not to emit, and a
 * conversational preamble wrapped around the object. This helper is the single
 * place that handles them, so hardening it hardens both call sites at once
 * (CHATBOT_IMPLEMENTATION_PLAN §4.2).
 *
 * Lifted verbatim from parseClassificationResponse so the extraction is a pure
 * refactor — the behaviour every existing classification run depends on is
 * unchanged.
 */

/**
 * Strip markdown fences, JSON.parse, and fall back to the outermost {…} span.
 * Throws an Error naming the offending text when nothing parseable is found
 * (NFR-09).
 */
export function extractJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = String(rawText ?? '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error(
        `AI returned a non-JSON response: ${cleaned.slice(0, 200) || '(empty)'}`
      );
    }
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  }
}

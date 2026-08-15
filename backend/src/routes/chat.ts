/**
 * FR-52 / FR-53 / FR-54: POST /api/chat — turn the QA engineer's plain-English
 * description of what they expect into a structured ExpectationRules object,
 * returned for confirmation before it is ever applied to a comparison.
 *
 * JSON, not multipart; the existing express.json({ limit: '50mb' }) in index.ts
 * already handles it.
 */
import { Router, Request, Response } from 'express';
import { ChatMessage, ChatResponse, ExpectationRules } from '../types';
import { EXTRACTION_SYSTEM_PROMPT } from '../services/chatPrompt';
import { extractJsonObject } from '../services/jsonFromModel';
import {
  MAX_RAW_LENGTH,
  runTextProvider,
  validateExpectationRules,
} from '../services/textProvider';

const router = Router();

// SEC-12: bound everything before it reaches a model prompt.
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 4000;
const MAX_PAYLOAD_BYTES = 32 * 1024;

/** Returns an actionable message (NFR-09), or null when the payload is fine. */
function validateMessages(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return 'Field "messages" must be an array of { role, content } objects.';
  }
  if (value.length < 1 || value.length > MAX_MESSAGES) {
    return `Field "messages" must contain between 1 and ${MAX_MESSAGES} items (received ${value.length}).`;
  }
  for (const [i, msg] of value.entries()) {
    if (typeof msg !== 'object' || msg === null) {
      return `messages[${i}] must be an object with "role" and "content".`;
    }
    const { role, content } = msg as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') {
      return `messages[${i}].role must be "user" or "assistant".`;
    }
    if (typeof content !== 'string') {
      return `messages[${i}].content must be a string.`;
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return `messages[${i}].content exceeds the ${MAX_CONTENT_LENGTH}-character limit (received ${content.length}).`;
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PAYLOAD_BYTES) {
    return `The conversation payload exceeds the ${MAX_PAYLOAD_BYTES / 1024} KB limit. Shorten the description.`;
  }
  return null;
}

router.post('/', async (req: Request, res: Response) => {
  const problem = validateMessages(req.body?.messages);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  // Safe after validateMessages: every element has been shape-checked.
  const messages = req.body.messages as ChatMessage[];

  try {
    const rawText = await runTextProvider({
      messages,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    });

    // Chat messages are NOT logged (§7.6): morgan logs request lines, not
    // bodies. Do not add body logging here while debugging and leave it in.
    const parsed = extractJsonObject(rawText);

    // SEC-12: rules.raw is assembled server-side from the user's own messages.
    // The model does not get to decide what the user said — that is what makes
    // the """-delimited block in the vision prompt trustworthy.
    const raw = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n')
      .slice(0, MAX_RAW_LENGTH);

    const rules: ExpectationRules = validateExpectationRules({
      ...parsed,
      raw,
    }) ?? { expected: [], unexpected: [], ignore: [], summary: '', raw };

    const reply =
      typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim().slice(0, MAX_CONTENT_LENGTH)
        : 'I could not find any expectations in that. Try describing what you changed on purpose, and what must not change.';

    const response: ChatResponse = { reply, rules };
    return res.json(response);
  } catch (error) {
    console.error('Chat error:', (error as Error)?.message);
    // Services throw Error with actionable text; the route maps it to a status
    // code (NFR-09).
    return res
      .status(500)
      .json({ error: (error as Error)?.message || 'Chat extraction failed' });
  }
});

export default router;

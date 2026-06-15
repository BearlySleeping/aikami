// apps/e2e/scripts/shared/ai_eval.ts
// Shared AI visual evaluation utilities for visual testing scripts.
//
// Sends screenshots to OpenRouter for AI-powered visual assessment
// with structured output validated against a runtime schema.

// ── Types ─────────────────────────────────────────────────────

/** Structured AI evaluation result for a single screenshot. */
export type VisualEvalResult = {
  /** Score from 0 to 100 — overall visual quality. */
  score: number;
  /** Whether a character is visible on the canvas. */
  characterVisible: boolean;
  /** Brief analysis notes from the AI. */
  notes: string;
  /** List of specific issues found, if any. */
  issues?: string[];
};

// ── Runtime validation ────────────────────────────────────────

/**
 * Validates and coerces a raw object into a {@link VisualEvalResult}.
 *
 * Throws if required fields are missing or have wrong types.
 */
const validateResult = (raw: unknown): VisualEvalResult => {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AI evaluation result is not an object');
  }

  const obj = raw as Record<string, unknown>;

  const score = Number(obj.score);
  if (Number.isNaN(score) || score < 0 || score > 100) {
    throw new Error(`Invalid score: ${obj.score}`);
  }

  const characterVisible = Boolean(obj.characterVisible);

  const notes = String(obj.notes ?? '');
  if (!notes) {
    throw new Error('Missing notes field');
  }

  const issues = Array.isArray(obj.issues)
    ? obj.issues.filter((i): i is string => typeof i === 'string')
    : undefined;

  return { score, characterVisible, notes, issues };
};

// ── Configuration ─────────────────────────────────────────────

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';

// ── Public API ────────────────────────────────────────────────

export type EvalOptions = {
  /** OpenRouter model name. */
  model?: string;
  /** Base64-encoded image data URI. */
  imageDataUri: string;
  /** Custom evaluation prompt. */
  prompt?: string;
  /** OpenRouter API key. Falls back to OPENROUTER_API_KEY env var. */
  apiKey?: string;
  /** Maximum retries for JSON parse failures. */
  maxRetries?: number;
};

/**
 * Default evaluation prompt used when none is provided.
 */
export const DEFAULT_EVAL_PROMPT = [
  'This is a screenshot from a pixel-art RPG game called Aikami.',
  'Rate this image on a scale of 0 to 100 based on:',
  '- Is there a visible character on the canvas?',
  '- Are the character layers composited correctly (head, body, hair, legs, feet)?',
  '- Is the character visible and not cut off?',
  '- Is the background dark (dark blue/grey)?',
  '',
  'Return ONLY a JSON object matching this schema:',
  '{"score": number, "characterVisible": boolean, "notes": string, "issues": string[]}',
].join('\n');

/**
 * Sends a screenshot to OpenRouter for AI visual evaluation.
 *
 * Uses Gemini Flash by default for fast, cost-effective visual analysis.
 * The response is parsed through a Zod schema to guarantee structured output.
 *
 * @returns A structured {@link VisualEvalResult}.
 */
export const evaluateScreenshot = async (
  options: EvalOptions,
): Promise<VisualEvalResult> => {
  const {
    model = DEFAULT_MODEL,
    imageDataUri,
    prompt = DEFAULT_EVAL_PROMPT,
    apiKey: key = process.env.OPENROUTER_API_KEY,
    maxRetries = 2,
  } = options;

  if (!key) {
    throw new Error(
      'OPENROUTER_API_KEY not set. Export it or pass apiKey in options.',
    );
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageDataUri } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        throw new Error(`OpenRouter ${res.status}: ${text}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenRouter');
      }

      // Try to parse JSON from the content (may include markdown fences)
      const json = extractJson(content);
      return validateResult(json);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        // Brief backoff before retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
};

// ── Helpers ───────────────────────────────────────────────────

/**
 * Extracts a JSON object from AI response text, handling markdown
 * code fences and other formatting artifacts.
 */
const extractJson = (text: string): unknown => {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Try extracting from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  // Try finding a JSON object anywhere in the text
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      // fall through to error
    }
  }

  throw new Error(`Cannot extract JSON from AI response: ${text.slice(0, 200)}`);
};

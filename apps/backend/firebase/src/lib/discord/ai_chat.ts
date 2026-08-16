// apps/backend/firebase/src/discord/ai_chat.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors HTTP header names (Authorization) and OpenRouter's JSON response keys
//
// Answers /ask questions via OpenRouter, grounded in the project's own
// generated knowledge file (.context/llms.txt, see
// scripts/src/lib/ops/generate_llms_txt.ts) so answers are about Aikami
// specifically instead of generic chat. Plain fetch, not
// scripts/src/lib/ai/ai_text_client.ts — that client lives in the
// scripts-only @aikami/scripts package, which this Firebase app doesn't
// depend on; duplicating the ~15 lines needed here isn't worth a package
// move for one call site.

import { logger } from '$logger';

/** Same attribution headers ai_text_client.ts sends OpenRouter for free-model ranking. */
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://aikami.app',
  'X-Title': 'Aikami',
} as const;

const LLMS_TXT_URL =
  'https://raw.githubusercontent.com/BearlySleeping/aikami/main/.context/llms.txt';
/** Keep the grounding context well under a free model's typical context budget. */
const LLMS_TXT_MAX_CHARS = 12_000;
/** Re-fetch at most this often — llms.txt changes rarely, and this saves a GitHub round-trip per /ask. */
const LLMS_TXT_CACHE_MS = 60 * 60 * 1000;

let cachedContext: { text: string; fetchedAt: number } | undefined;

async function getProjectContext(): Promise<string> {
  if (cachedContext && Date.now() - cachedContext.fetchedAt < LLMS_TXT_CACHE_MS) {
    return cachedContext.text;
  }
  try {
    const res = await fetch(LLMS_TXT_URL, { signal: AbortSignal.timeout(5_000) });
    const text = res.ok ? (await res.text()).slice(0, LLMS_TXT_MAX_CHARS) : '';
    cachedContext = { text, fetchedAt: Date.now() };
    return text;
  } catch (err) {
    logger.warn(`discord/ai_chat: failed to fetch llms.txt context: ${(err as Error).message}`);
    return cachedContext?.text ?? '';
  }
}

export async function askProjectAi(options: {
  question: string;
  apiKey: string;
  model: string;
}): Promise<string> {
  const { question, apiKey, model } = options;
  const projectContext = await getProjectContext();

  const systemPrompt = projectContext
    ? `You are the Aikami project's Discord assistant. Answer questions about the project accurately and concisely, using the reference material below. If the answer isn't in it, say you're not sure rather than guessing.\n\n${projectContext}`
    : "You are the Aikami project's Discord assistant. Answer concisely. If you don't know, say so.";

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...OPENROUTER_HEADERS,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text().catch(() => '')}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = json.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    throw new Error('OpenRouter returned no answer.');
  }
  return answer;
}

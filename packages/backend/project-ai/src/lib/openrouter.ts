// packages/backend/project-ai/src/lib/openrouter.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors HTTP header names (Authorization) and OpenRouter's JSON response keys
//
// Plain fetch OpenRouter client — no SDK, matching this repo's convention
// for anything backed by a handful of REST calls (see
// apps/backend/worker/src/secrets.ts, scripts/src/lib/discord/).

const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://aikami.app',
  'X-Title': 'Aikami',
} as const;

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function chatCompletion(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  jsonMode?: boolean;
}): Promise<string> {
  const { apiKey, model, messages, jsonMode } = options;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...OPENROUTER_HEADERS,
    },
    body: JSON.stringify({
      model,
      messages,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter request failed: ${res.status} ${await res.text().catch(() => '')}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenRouter returned no content.');
  }
  return content;
}

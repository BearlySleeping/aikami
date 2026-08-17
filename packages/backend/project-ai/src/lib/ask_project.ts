// packages/backend/project-ai/src/lib/ask_project.ts
//
// Answers questions about the Aikami project, grounded in the project's own
// generated knowledge file (.context/llms.txt, see
// scripts/src/lib/ops/generate_llms_txt.ts). Shared by every "ask" surface
// this project has: the Discord Interactions Endpoint's /ask command, the
// Gateway bot's in-thread conversational replies (recent thread history
// passed as `history`), and the hub's public POST /api/ask.

import { type ChatMessage, chatCompletion } from './openrouter';

const LLMS_TXT_URL =
  'https://raw.githubusercontent.com/BearlySleeping/aikami/main/.context/llms.txt';
/** Keep the grounding context well under a free model's typical context budget. */
const LLMS_TXT_MAX_CHARS = 12_000;
/** Re-fetch at most this often — llms.txt changes rarely, and this saves a GitHub round-trip per call. */
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
  } catch {
    return cachedContext?.text ?? '';
  }
}

export type ThreadMessage = { author: string; content: string };

/** Answers a question about Aikami, optionally continuing recent conversation history (e.g. a Discord thread). */
export async function askProjectAi(options: {
  question: string;
  apiKey: string;
  model: string;
  history?: ThreadMessage[];
}): Promise<string> {
  const { question, apiKey, model, history = [] } = options;
  const projectContext = await getProjectContext();

  const systemPrompt = projectContext
    ? `You are the Aikami project's assistant. Answer accurately and concisely, using the reference material below. If the answer isn't in it, say you're not sure rather than guessing.\n\n${projectContext}`
    : "You are the Aikami project's assistant. Answer concisely. If you don't know, say so.";

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: 'user' as const, content: `${m.author}: ${m.content}` })),
    { role: 'user', content: question },
  ];

  return chatCompletion({ apiKey, model, messages });
}

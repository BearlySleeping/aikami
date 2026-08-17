// packages/backend/discord-bot/src/lib/ai_chat.ts
// biome-ignore-all lint/style/useNamingConvention: mirrors OpenRouter's JSON response keys
//
// GitHub-issue summarization for the moderator "github issue" trigger — the
// one piece of AI logic that's genuinely Discord/GitHub-specific. The
// conversational /ask logic (askProjectAi) now lives in
// @aikami/backend-project-ai, shared with the Discord Interactions Endpoint
// (lib/interactions) and the hub's public /api/ask — re-exported here so
// message_create.ts's existing import path keeps working.

import { chatCompletion, type ThreadMessage } from '@aikami/backend-project-ai';

export { askProjectAi, type ThreadMessage } from '@aikami/backend-project-ai';

export type IssueSummary = { title: string; body: string };

/** Rewrites a forum thread's opening post + replies into a concise GitHub issue title/body. */
export async function summarizeThreadAsIssue(options: {
  threadTitle: string;
  messages: ThreadMessage[];
  apiKey: string;
  model: string;
}): Promise<IssueSummary> {
  const { threadTitle, messages, apiKey, model } = options;
  const transcript = messages.map((m) => `${m.author}: ${m.content}`).join('\n\n');

  const content = await chatCompletion({
    apiKey,
    model,
    jsonMode: true,
    messages: [
      {
        role: 'system',
        content:
          'You turn a Discord support-forum thread into a concise, well-written GitHub issue. ' +
          'Respond with ONLY a JSON object: {"title": string, "body": string}. ' +
          'The title should be a short, specific summary (no more than ~80 chars). ' +
          'The body should summarize the report/request clearly in Markdown, preserving any ' +
          'diagnostics block verbatim in a code fence if one is present. Do not invent details ' +
          'that are not in the thread.',
      },
      { role: 'user', content: `Thread title: ${threadTitle}\n\n${transcript}` },
    ],
  });

  try {
    const parsed = JSON.parse(content) as Partial<IssueSummary>;
    if (!parsed.title || !parsed.body) {
      throw new Error('missing title/body');
    }
    return { title: parsed.title, body: parsed.body };
  } catch {
    // Fall back to the raw transcript rather than failing the whole flow —
    // a slightly rougher issue is better than none.
    return { title: threadTitle, body: transcript };
  }
}

// packages/backend/discord-bot/src/lib/interactions/respond.ts
//
// Edits a deferred interaction's original response. Used after the initial
// ACK (DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) once the async work — calling
// OpenRouter — finishes.
//
// No Authorization header: this webhook endpoint is authenticated by the
// interaction token itself (Discord's design — see the Interactions docs),
// so this function never needs DISCORD_BOT_TOKEN.

import { logger } from '@aikami/logger';

/** Discord hard-caps message content at 2000 chars. */
const DISCORD_MESSAGE_MAX = 2000;

/** Bounded wait for the Discord webhook PATCH — a stalled request must not
 *  hang forever. On abort the error is logged and swallowed, entering the
 *  same error path as a non-OK response below. */
const DISCORD_FETCH_TIMEOUT_MS = 10_000;

export function truncateForDiscord(text: string): string {
  return text.length <= DISCORD_MESSAGE_MAX ? text : `${text.slice(0, DISCORD_MESSAGE_MAX - 1)}…`;
}

export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: truncateForDiscord(content) }),
      signal: AbortSignal.timeout(DISCORD_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // fetch only throws on network failure or the abort above — both mean
    // the edit could not be delivered. Log and continue (this function
    // never throws; the caller already reported the underlying failure).
    logger.error(
      `discord-bot/interactions/respond: failed to edit interaction response: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (!res.ok) {
    logger.error(
      `discord-bot/interactions/respond: failed to edit interaction response (${res.status}): ${await res.text().catch(() => '')}`,
    );
  }
}

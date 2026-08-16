// apps/backend/firebase/src/discord/respond.ts
//
// Edits a deferred interaction's original response. Used after the initial
// ACK (DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) once the async work — creating
// a GitHub issue, calling OpenRouter — finishes.
//
// No Authorization header: this webhook endpoint is authenticated by the
// interaction token itself (Discord's design — see the Interactions docs),
// so this function never needs DISCORD_BOT_TOKEN.

import { logger } from '$logger';

/** Discord hard-caps message content at 2000 chars. */
const DISCORD_MESSAGE_MAX = 2000;

export function truncateForDiscord(text: string): string {
  return text.length <= DISCORD_MESSAGE_MAX ? text : `${text.slice(0, DISCORD_MESSAGE_MAX - 1)}…`;
}

export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: truncateForDiscord(content) }),
  });
  if (!res.ok) {
    logger.error(
      `discord/respond: failed to edit interaction response (${res.status}): ${await res.text().catch(() => '')}`,
    );
  }
}

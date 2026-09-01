// scripts/src/lib/discord/post.ts
//
// TASK 4's "one bot, one voice" — the single posting helper that replaces
// discord_notify.ts's/discord_dev_notify.ts's old per-purpose webhooks.
// Signs a request with WORKER_NOTIFY_SECRET and POSTs it to the worker
// VM's /notify endpoint (packages/backend/discord-bot's discordNotify
// plugin), which holds the actual bot token and posts through a live
// discord.js Client — so the message appears as AiKami Bot, not a webhook
// identity. We deliberately never put DISCORD_BOT_TOKEN in CI; this is the
// low-value secret CI holds instead.
//
// Best-effort, same property the webhook scripts had: on any failure, warn
// and return — never throw, never fail a release or a CI job over this.

import { createHmac } from 'node:crypto';
import { type DISCORD_CHANNELS, WORKER_URL } from '@aikami/constants';
import type { APIEmbed } from 'discord-api-types/v10';
import { warn } from '../cli_utils';
import { initScriptsEnv } from '../env/scripts_env';

/** Same purpose keys as @aikami/constants' DISCORD_CHANNELS — computed from it so the two can never drift apart. */
export type DiscordChannelKey = keyof typeof DISCORD_CHANNELS;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Posts `embed` to `channel` through the worker's /notify relay, appearing
 * as AiKami Bot. No-ops (warns and returns `false`) when
 * WORKER_NOTIFY_SECRET isn't configured for `mode`, and on any request
 * failure — never throws. Returns whether the post actually went through,
 * so a caller can decide whether to log success or just move on.
 */
export const postToDiscord = async (options: {
  channel: DiscordChannelKey;
  embed: APIEmbed;
  /** The only role this relay is allowed to @-mention — see structure.ts's "Release Pings" role. */
  roleMention?: 'releasePings';
  mode?: string;
}): Promise<boolean> => {
  const { channel, embed, roleMention, mode = 'production' } = options;
  initScriptsEnv(mode);

  const secret = process.env.WORKER_NOTIFY_SECRET;
  if (!secret) {
    warn('WORKER_NOTIFY_SECRET not set — skipping Discord notification.');
    return false;
  }

  try {
    const bodyJson = JSON.stringify({ channel, embed, roleMention });
    const timestamp = String(Date.now());
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(bodyJson)
      .digest('hex')}`;

    const res = await fetch(`${WORKER_URL}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-aikami-timestamp': timestamp,
        'x-aikami-signature': signature,
      },
      body: bodyJson,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Discord notify relay POST failed: ${res.status} ${res.statusText}`);
    }
    return true;
  } catch (err) {
    warn(`Discord notification skipped: ${(err as Error).message}`);
    return false;
  }
};

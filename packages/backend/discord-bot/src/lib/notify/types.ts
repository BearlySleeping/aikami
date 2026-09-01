// packages/backend/discord-bot/src/lib/notify/types.ts
//
// Wire shape + env for the /notify relay (handler.ts) — TASK 4's "one bot,
// one voice": CI never holds DISCORD_BOT_TOKEN (see release.yml/
// discord_dev_notify.yml), so it POSTs here instead of using a per-channel
// webhook, and this always-on process (which DOES hold the token) posts
// through its live discord.js Client so the message appears as AiKami Bot.

import type { DISCORD_CHANNELS } from '@aikami/constants';
import type { APIEmbed } from 'discord.js';

/** Same purpose keys as @aikami/constants' DISCORD_CHANNELS — computed from it so the two can never drift apart. */
export type DiscordChannelKey = keyof typeof DISCORD_CHANNELS;

/** JSON payload accepted by the authenticated `/notify` relay. */
export type NotifyRequestBody = {
  channel: DiscordChannelKey;
  embed: APIEmbed;
  /** The only role this relay is allowed to @-mention — see structure.ts's "Release Pings" role. */
  roleMention?: 'releasePings';
};

export const DISCORD_NOTIFY_REQUIRED_ENV_KEYS = ['WORKER_NOTIFY_SECRET'] as const;

/** Environment credentials required to authenticate notify relay requests. */
export type DiscordNotifyEnv = Record<(typeof DISCORD_NOTIFY_REQUIRED_ENV_KEYS)[number], string>;

// scripts/src/lib/discord/content.ts
//
// Idempotent pinned-content sync for #welcome, #rules, and #faq: post the
// text once, then EDIT the same message in place on every later run instead
// of posting a duplicate.
//
// Identity: no message id is stored anywhere (not in this file, not in a
// side-channel state file). Instead, each run lists the channel's recent
// messages and finds the one authored by this bot (`GET /users/@me` for the
// bot's own id, then a name match against `message.author.id`) — the first
// one found (Discord orders newest-first) is treated as "ours" and edited;
// if none exists yet, one is posted and pinned. This was chosen over a
// stored id because a stored id is itself a second source of truth that can
// drift (channel gets cleared, id file goes stale, wrong mode's id used) —
// asking Discord "which message here is mine?" can't drift, at the cost of
// one extra list call per channel per run (cheap, this only runs manually).
// If the bot ever posts MORE than one message in these channels for other
// reasons, this would pick up the wrong one — acceptable today since
// nothing else posts here, but worth revisiting if that changes.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { c, log, ok } from '../cli_utils';
import { listChannels } from './channels';
import { initDiscordClient } from './client';

type ContentEntry = { channel: string; body: string };

// ─── Edit below this line ───────────────────────────────────────────────
const CONTENT: ContentEntry[] = [
  { channel: 'welcome', body: 'TODO(copy): welcome message.' },
  { channel: 'rules', body: 'TODO(copy): six-line rules summary.' },
  { channel: 'faq', body: 'TODO(copy): frequently asked questions.' },
];
// ─────────────────────────────────────────────────────────────────────────

type DiscordMessage = { id: string; author: { id: string } };
type DiscordUser = { id: string };

async function findOwnMessage(
  rest: REST,
  channelId: string,
  botUserId: string,
): Promise<DiscordMessage | undefined> {
  const messages = (await rest.get(Routes.channelMessages(channelId), {
    query: new URLSearchParams({ limit: '50' }),
  })) as DiscordMessage[];
  // Newest first — the most recent message we posted here is "ours".
  return messages.find((m) => m.author.id === botUserId);
}

export async function runContentSync(mode = 'production'): Promise<void> {
  const { rest, guildId } = initDiscordClient(mode);

  const [channels, me] = await Promise.all([
    listChannels(rest, guildId),
    rest.get(Routes.user('@me')) as Promise<DiscordUser>,
  ]);
  const channelIdByName = new Map(channels.map((ch) => [ch.name, ch.id]));

  for (const entry of CONTENT) {
    const channelId = channelIdByName.get(entry.channel);
    if (!channelId) {
      throw new Error(
        `content:sync references channel "${entry.channel}", which doesn't exist live.`,
      );
    }

    log(`Syncing #${entry.channel}...`);
    const existing = await findOwnMessage(rest, channelId, me.id);
    if (existing) {
      await rest.patch(Routes.channelMessage(channelId, existing.id), {
        body: { content: entry.body },
      });
      ok(`Updated pinned message in ${c.bold}#${entry.channel}${c.reset}`);
      continue;
    }

    const created = (await rest.post(Routes.channelMessages(channelId), {
      body: { content: entry.body },
    })) as DiscordMessage;
    await rest.put(Routes.channelPin(channelId, created.id));
    ok(`Posted + pinned message in ${c.bold}#${entry.channel}${c.reset}`);
  }
}

// scripts/src/lib/discord/content.ts
//
// Idempotent pinned-content sync for #welcome, #rules, and #faq: post the
// text once, then EDIT the same message in place on every later run instead
// of posting a duplicate.
//
// Identity: no message id is stored anywhere (not in this file, not in a
// side-channel state file). Instead, each run lists the channel's pinned
// messages and finds the one authored by this bot (`GET /users/@me` for the
// bot's own id, then an id match against `message.author.id`) — the first
// one found is treated as "ours" and edited. If no pin is ours, the last
// 100 messages are scanned the same way (someone unpinned it by hand) and a
// match is edited + re-pinned; only when that also finds nothing is a new
// message posted. This was chosen over a stored id because a stored id is
// itself a second source of truth that can drift (channel gets cleared, id
// file goes stale, wrong mode's id used) — asking Discord "which message
// here is mine?" can't drift, at the cost of one or two extra list calls
// per channel per run (cheap, this only runs manually).
// If the bot ever posts MORE than one message in these channels for other
// reasons, this would pick up the wrong one — acceptable today since
// nothing else posts here, but worth revisiting if that changes.
//
// Two things in the copy below are resolved at post time rather than
// hardcoded: `#channel` tokens become real Discord channel links, and the
// site URLs come from deployment_config's APP_CONFIG — see
// renderChannelMentions and appUrl.

import type { AppId } from '@aikami/types';
import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { c, log, ok } from '../cli_utils';
import { resolveCloudflareRoute } from '../deploy/deployment_config';
import { listChannels } from './channels';
import { initDiscordClient } from './client';

type ContentEntry = { channel: string; body: string };

/** Discord's hard limit for a single message's content. */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * Public HTTPS URL for `appId` in `mode`, falling back to the production
 * domain when that app has no domain for the mode (the client, for one, has
 * no staging domain). Read from APP_CONFIG rather than written out here so
 * the links posted into Discord can't drift from where things deploy.
 */
function appUrl(appId: AppId, mode: string): string {
  const domain = resolveCloudflareRoute(appId, mode) ?? resolveCloudflareRoute(appId, 'production');
  if (!domain) {
    throw new Error(`content:sync has no Cloudflare domain configured for app "${appId}".`);
  }
  return `https://${domain}`;
}

/**
 * Builds the desired copy for `mode`. A function rather than a constant
 * because the links are mode-dependent — a staging guild gets the staging
 * domains.
 */
function buildContent(mode: string): ContentEntry[] {
  const links = {
    site: appUrl('site', mode),
    docs: appUrl('docs', mode),
    hub: appUrl('hub', mode),
    play: appUrl('client', mode),
  };

  // ─── Edit below this line ─────────────────────────────────────────────
  return [
    {
      channel: 'welcome',
      body: [
        '👋 **Welcome to Aikami** — an open-source, AI-native RPG that plays offline and is yours to modify.',
        '',
        'Start here:',
        '📜 Read the rules in #rules',
        '💬 Say hello in #general',
        '🖼️ Share what you make in #showcase',
        '🐛 Got a bug, idea, or question? Post in #support',
        '❓ Links and common questions live in #faq',
        '',
        `🎮 Play now: ${links.play}`,
        '',
        'Enjoy your stay!',
      ].join('\n'),
    },
    {
      channel: 'rules',
      body: [
        '**Rules**',
        '1. Be respectful — no harassment, hate speech, or personal attacks.',
        '2. Use the right channel — bugs/questions go in #support, chat in #general.',
        '3. Listen to Moderators and Admins.',
        '4. Have fun, and help others enjoy Aikami too.',
      ].join('\n'),
    },
    {
      channel: 'faq',
      body: [
        '**Frequently Asked Questions**',
        '',
        '**Is Aikami free?**',
        "Yes — it's free and open-source.",
        '',
        '**Where do I play it?**',
        `In your browser at ${links.play} — desktop builds are linked from ${links.site}.`,
        '',
        '**Does it need an internet connection?**',
        'No — after the first-time download it plays fully offline.',
        '',
        '**Can I modify it?**',
        `Yes — the game and its content are yours to modify. The guides and API reference are at ${links.docs}.`,
        '',
        '**Where do I find community packs?**',
        `On the hub: ${links.hub} — browse what others made, or publish your own.`,
        '',
        '**Where do I report a bug or request a feature?**',
        'Post in #support — a moderator will follow up.',
        '',
        '**How do I get a role like Developer, Creator, or Player?**',
        'Pick it during onboarding, or ask a moderator to update your roles.',
        '',
        '**Links**',
        `🌐 Site — ${links.site}`,
        `🎮 Play — ${links.play}`,
        `📚 Docs — ${links.docs}`,
        `🧩 Hub — ${links.hub}`,
      ].join('\n'),
    },
  ];
  // ───────────────────────────────────────────────────────────────────────
}

// A bare "#support" in message text is NOT a link in Discord — it only
// looks like one. The real thing is `<#channelId>`, which renders as a
// clickable #support. So every `#name` in the copy above is rewritten to
// `<#id>` against the live channel list at post time, and a name with no
// live channel is a hard error rather than dead-looking text shipped to the
// server. The lookbehind keeps already-resolved `<#123>` ids and Discord's
// `# Heading` markdown (space after the #) out of the match.
const CHANNEL_MENTION_PATTERN = /(?<![\w<#])#([a-z0-9][a-z0-9_-]*)/g;

function renderChannelMentions(options: {
  body: string;
  channel: string;
  channelIdByName: Map<string, string>;
}): string {
  const { body, channel, channelIdByName } = options;
  return body.replace(CHANNEL_MENTION_PATTERN, (match, name: string) => {
    const id = channelIdByName.get(name);
    if (!id) {
      throw new Error(
        `content:sync copy for #${channel} mentions "${match}", which doesn't exist live.`,
      );
    }
    return `<#${id}>`;
  });
}

type DiscordMessage = { id: string; author: { id: string } };
type DiscordPinPage = {
  items: { pinned_at: string; message: DiscordMessage }[];
  has_more: boolean;
};
type DiscordUser = { id: string };

async function findOwnPinnedMessage(
  rest: REST,
  channelId: string,
  botUserId: string,
): Promise<DiscordMessage | undefined> {
  let before: string | undefined;
  while (true) {
    const query = new URLSearchParams({ limit: '50' });
    if (before) {
      query.set('before', before);
    }
    const page = (await rest.get(Routes.channelMessagesPins(channelId), {
      query,
    })) as DiscordPinPage;
    const ownPin = page.items.find((item) => item.message.author.id === botUserId);
    if (ownPin) {
      return ownPin.message;
    }
    const lastPin = page.items.at(-1);
    if (!page.has_more || !lastPin) {
      return undefined;
    }
    before = lastPin.pinned_at;
  }
}

/**
 * Fallback for a message of ours that someone unpinned: the newest bot-authored
 * message in the channel's last 100. Bounded on purpose — one page is plenty for
 * these three low-traffic channels, and without a bound a busy channel would be
 * paged through on every run just to conclude nothing is there.
 */
async function findOwnRecentMessage(
  rest: REST,
  channelId: string,
  botUserId: string,
): Promise<DiscordMessage | undefined> {
  const messages = (await rest.get(Routes.channelMessages(channelId), {
    query: new URLSearchParams({ limit: '100' }),
  })) as DiscordMessage[];
  return messages.find((message) => message.author.id === botUserId);
}

/**
 * Synchronizes configured pinned content for the requested environment mode.
 * @param mode Environment whose Discord credentials and guild should be used.
 * @throws When placeholder copy remains or a configured channel does not exist live.
 */
export async function runContentSync(mode = 'production'): Promise<void> {
  const content = buildContent(mode);
  const placeholderEntry = content.find((entry) => entry.body.includes('TODO(copy)'));
  if (placeholderEntry) {
    throw new Error(
      `content:sync refuses placeholder copy in #${placeholderEntry.channel}; replace TODO(copy) first.`,
    );
  }

  const { rest, guildId } = initDiscordClient(mode);

  const [channels, me] = await Promise.all([
    listChannels(rest, guildId),
    rest.get(Routes.user('@me')) as Promise<DiscordUser>,
  ]);
  const channelIdByName = new Map(channels.map((ch) => [ch.name, ch.id]));

  for (const entry of content) {
    const channelId = channelIdByName.get(entry.channel);
    if (!channelId) {
      throw new Error(
        `content:sync references channel "${entry.channel}", which doesn't exist live.`,
      );
    }

    const body = renderChannelMentions({
      body: entry.body,
      channel: entry.channel,
      channelIdByName,
    });
    if (body.length > MAX_MESSAGE_LENGTH) {
      throw new Error(
        `content:sync copy for #${entry.channel} is ${body.length} chars, over Discord's ${MAX_MESSAGE_LENGTH} limit.`,
      );
    }

    log(`Syncing #${entry.channel}...`);
    const pinned = await findOwnPinnedMessage(rest, channelId, me.id);
    const existing = pinned ?? (await findOwnRecentMessage(rest, channelId, me.id));
    if (existing) {
      await rest.patch(Routes.channelMessage(channelId, existing.id), {
        body: { content: body },
      });
      if (!pinned) {
        await rest.put(Routes.channelMessagesPin(channelId, existing.id));
      }
      ok(`Updated pinned message in ${c.bold}#${entry.channel}${c.reset}`);
      continue;
    }

    const created = (await rest.post(Routes.channelMessages(channelId), {
      body: { content: body },
    })) as DiscordMessage;
    await rest.put(Routes.channelMessagesPin(channelId, created.id));
    ok(`Posted + pinned message in ${c.bold}#${entry.channel}${c.reset}`);
  }
}

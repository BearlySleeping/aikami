// packages/backend/discord-bot/src/lib/notify/handler.ts
//
// HTTP relay so CI (which never holds DISCORD_BOT_TOKEN — see TASK 4's
// "one bot, one voice" goal) can post a message that appears as AiKami Bot,
// through the SAME live discord.js Client the Gateway bot already runs
// (index.ts passes it in) rather than opening a second connection. Auth is
// a shared-secret HMAC (WORKER_NOTIFY_SECRET, see verify.ts) — this route
// is never called BY Discord, so Discord's own Ed25519 Interactions
// signature (../interactions/verify.ts) doesn't apply here.

import { DISCORD_CHANNELS, DISCORD_ROLES } from '@aikami/constants';
import { logger } from '@aikami/logger';
import { ChannelType, type Client } from 'discord.js';
import { Elysia } from 'elysia';
import type { DiscordChannelKey, DiscordNotifyEnv, NotifyRequestBody } from './types';
import { verifyNotifySignature } from './verify';

function isKnownChannelKey(value: string): value is DiscordChannelKey {
  return value in DISCORD_CHANNELS;
}

export function discordNotify(client: Client, env: DiscordNotifyEnv) {
  return new Elysia().post('/notify', async ({ request, set }) => {
    // Read the exact raw bytes the caller signed — do not go through
    // Elysia's parsed `body`, which would re-serialize and break the HMAC
    // (same reasoning as ../interactions/handler.ts's rawBody read).
    const rawBody = Buffer.from(await request.arrayBuffer());

    const signatureOk = verifyNotifySignature({
      signature: request.headers.get('x-aikami-signature') ?? undefined,
      timestamp: request.headers.get('x-aikami-timestamp') ?? undefined,
      rawBody,
      secret: env.WORKER_NOTIFY_SECRET,
    });
    if (!signatureOk) {
      set.status = 401;
      return 'invalid signature';
    }

    let body: NotifyRequestBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as NotifyRequestBody;
    } catch {
      set.status = 400;
      return 'invalid JSON body';
    }

    if (!body.channel || !isKnownChannelKey(body.channel)) {
      set.status = 400;
      return `unknown channel "${body.channel}"`;
    }
    const channelId = DISCORD_CHANNELS[body.channel];
    if (!channelId) {
      // A key exists in DISCORD_CHANNELS but with an empty placeholder
      // value (see that file's comments) — not yet safe to post to.
      set.status = 400;
      return `channel "${body.channel}" has no live id configured yet`;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        set.status = 400;
        return `channel "${body.channel}" is not a postable guild text channel`;
      }

      const roleId = body.roleMention === 'releasePings' ? DISCORD_ROLES.releasePings : undefined;
      const message = await channel.send({
        content: roleId ? `<@&${roleId}>` : undefined,
        embeds: [body.embed],
        allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
      });

      // Crosspost afterwards if the target channel is an announcement
      // channel (e.g. #releases) — publishes it to every server following
      // this one, same as clicking the "Publish" button by hand.
      if (channel.type === ChannelType.GuildAnnouncement) {
        await message.crosspost();
      }

      return { ok: true };
    } catch (err) {
      logger.error(
        `discord-bot/notify: failed to post to "${body.channel}": ${(err as Error).message}`,
      );
      set.status = 500;
      return 'failed to post';
    }
  });
}

// scripts/src/lib/discord/channels.ts
//
// Thin typed wrappers over the Discord REST channel endpoints. No business
// logic here — sync.ts decides WHAT to create/update/delete, this module
// just knows HOW to make the call. See types.ts for why these use local
// shapes instead of discord-api-types' full channel union.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { ChannelCreateBody, ChannelUpdateBody, GuildChannel } from './types';

export async function listChannels(rest: REST, guildId: string): Promise<GuildChannel[]> {
  return (await rest.get(Routes.guildChannels(guildId))) as GuildChannel[];
}

export async function createChannel(
  rest: REST,
  guildId: string,
  body: ChannelCreateBody,
): Promise<GuildChannel> {
  return (await rest.post(Routes.guildChannels(guildId), { body })) as GuildChannel;
}

export async function updateChannel(
  rest: REST,
  channelId: string,
  body: ChannelUpdateBody,
): Promise<GuildChannel> {
  return (await rest.patch(Routes.channel(channelId), { body })) as GuildChannel;
}

export async function deleteChannel(
  rest: REST,
  channelId: string,
  reason = 'aikami discord sync',
): Promise<void> {
  await rest.delete(Routes.channel(channelId), { reason });
}

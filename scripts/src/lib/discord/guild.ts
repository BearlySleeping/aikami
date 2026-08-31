// scripts/src/lib/discord/guild.ts
//
// Thin typed wrappers over the Discord REST guild-settings endpoints. No
// business logic here — sync.ts decides WHAT to change, this module just
// knows HOW to make the call. See types.ts's sibling modules (channels.ts,
// roles.ts) for the same pattern.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { GuildSettings, GuildUpdateBody } from './types';

export async function getGuild(rest: REST, guildId: string): Promise<GuildSettings> {
  return (await rest.get(Routes.guild(guildId))) as GuildSettings;
}

export async function updateGuild(
  rest: REST,
  guildId: string,
  body: GuildUpdateBody,
): Promise<GuildSettings> {
  return (await rest.patch(Routes.guild(guildId), { body })) as GuildSettings;
}

// scripts/src/lib/discord/roles.ts
//
// Thin typed wrappers over the Discord REST role endpoints. No business
// logic here — sync.ts decides WHAT to create/update/delete, this module
// just knows HOW to make the call. See types.ts for why these use local
// shapes instead of discord-api-types' payload types.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { GuildRole, RoleCreateBody, RoleUpdateBody } from './types';

export async function listRoles(rest: REST, guildId: string): Promise<GuildRole[]> {
  return (await rest.get(Routes.guildRoles(guildId))) as GuildRole[];
}

export async function createRole(
  rest: REST,
  guildId: string,
  body: RoleCreateBody,
): Promise<GuildRole> {
  return (await rest.post(Routes.guildRoles(guildId), { body })) as GuildRole;
}

export async function updateRole(
  rest: REST,
  guildId: string,
  roleId: string,
  body: RoleUpdateBody,
): Promise<GuildRole> {
  return (await rest.patch(Routes.guildRole(guildId, roleId), { body })) as GuildRole;
}

export async function deleteRole(
  rest: REST,
  guildId: string,
  roleId: string,
  reason = 'aikami discord sync',
): Promise<void> {
  await rest.delete(Routes.guildRole(guildId, roleId), { reason });
}

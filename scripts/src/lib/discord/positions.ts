// scripts/src/lib/discord/positions.ts
//
// Thin typed wrappers over Discord's bulk position-update endpoints. Both
// roles and (non-thread) channels share the same shape: a PATCH with an
// array of {id, position} pairs — you only send the entries that actually
// need to move, not the full live set. No business logic here — diff.ts
// decides WHICH entries need a new position, sync.ts applies it.

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

export type PositionUpdate = { id: string; position: number };

export async function updateRolePositions(
  rest: REST,
  guildId: string,
  positions: PositionUpdate[],
): Promise<void> {
  if (positions.length === 0) {
    return;
  }
  await rest.patch(Routes.guildRoles(guildId), { body: positions });
}

export async function updateChannelPositions(
  rest: REST,
  guildId: string,
  positions: PositionUpdate[],
): Promise<void> {
  if (positions.length === 0) {
    return;
  }
  await rest.patch(Routes.guildChannels(guildId), { body: positions });
}

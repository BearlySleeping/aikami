// apps/frontend/client/src/lib/views/settings/ai/ai_roles.ts
//
// Pure role projections for the AI settings roles drawer. No state, no
// services — the ViewModel reads config and delegates here.

import type { AiConnection, AiRole, RoleAssignments } from '@aikami/types';
import type { ConnectionCapability } from '$types';

/** Every role a connection can serve, in display order. */
export const ALL_ROLES: readonly AiRole[] = [
  'narration',
  'dialogue',
  'summarization',
  'structured',
  'portrait',
  'scene',
  'narrator-voice',
  'npc-voice',
] as const;

/** Which capability a role is served by (mirrors the config service mapping). */
export const ROLE_CAPABILITY: Record<AiRole, ConnectionCapability> = {
  narration: 'text',
  dialogue: 'text',
  summarization: 'text',
  structured: 'text',
  portrait: 'image',
  scene: 'image',
  'narrator-voice': 'voice',
  'npc-voice': 'voice',
};

/** A connection with the roles currently assigned to it. */
export type ConnectionWithRoles = {
  connection: AiConnection;
  roles: AiRole[];
};

/** Pairs each connection with the roles it currently serves. */
export const buildConnectionsWithRoles = (
  connections: readonly AiConnection[],
  assignments: RoleAssignments,
): readonly ConnectionWithRoles[] =>
  connections
    .map((connection) => {
      const roles = (Object.keys(assignments) as AiRole[]).filter(
        (role) => assignments[role] === connection.id,
      );
      return { connection, roles };
    })
    .filter((entry) => entry.roles.length > 0);

/** Connections not currently serving any role. */
export const unassignedConnections = (
  connections: readonly AiConnection[],
  assignments: RoleAssignments,
): readonly AiConnection[] => {
  const assignedIds = new Set(Object.values(assignments));
  return connections.filter((connection) => !assignedIds.has(connection.id));
};

/** Roles a given capability can be assigned to. */
export const rolesForCapability = (capability: ConnectionCapability): readonly AiRole[] =>
  ALL_ROLES.filter((role) => ROLE_CAPABILITY[role] === capability);

// apps/frontend/client/src/lib/services/config/capability_tables.ts
//
// Which capabilities exist, which roles each one owns, and which capability a
// role may be served by (issue #381).
//
// Extracted from `config_service.svelte.ts` because these four tables are a
// single responsibility — the capability taxonomy — and because adding a
// capability to a 1,600-line service is exactly the kind of edit that should
// not require reading the whole persistence layer.
//
// `decision` is PROJECTION-ONLY: no gameplay call site reads a decision default,
// because workload qualification is a gate this release deliberately leaves
// closed. Projecting it makes the capability visible in settings without routing
// a single decision.

import type { AiRole, ConnectionCapability } from '@aikami/types';

/** Every capability, in a stable order for projection. */
const CAPABILITIES: readonly ConnectionCapability[] = ['text', 'image', 'voice', 'decision'];

/** Roles each capability owns. */
const ROLES_BY_CAPABILITY: Record<ConnectionCapability, readonly AiRole[]> = {
  text: ['narration', 'dialogue', 'summarization', 'structured'],
  image: ['portrait', 'scene'],
  voice: ['narrator-voice', 'npc-voice'],
  decision: ['decisions'],
};

/**
 * The role a capability's "default" maps onto. `defaultByCapability` and the
 * legacy `defaultConnectionId` are projections of these.
 */
const PRIMARY_ROLE: Record<ConnectionCapability, AiRole> = {
  text: 'narration',
  image: 'portrait',
  voice: 'narrator-voice',
  decision: 'decisions',
};

/**
 * The capability each role can be served by. A role may only point at a
 * connection of its own capability: `_reproject()` prunes roles whose
 * connection is *gone*, but it cannot tell that a surviving connection has
 * become the wrong kind. Without this, a voice connection could be projected
 * as `defaultByCapability.text`, and a capability-aware consumer that filters
 * it out is then left with no text provider at all.
 */
const ROLE_CAPABILITY: Record<AiRole, ConnectionCapability> = {
  narration: 'text',
  dialogue: 'text',
  summarization: 'text',
  structured: 'text',
  portrait: 'image',
  scene: 'image',
  'narrator-voice': 'voice',
  'npc-voice': 'voice',
  decisions: 'decision',
};
/**
 * Whether a connection of `actual` may serve a role owned by `expected`.
 *
 * Split out so the caller stays one line: the check is a rule, not a condition,
 * and `decision` being refused here is the whole point of it existing.
 */
export const canServeRole = (
  expected: ConnectionCapability,
  actual: ConnectionCapability | undefined,
): boolean => actual === expected && actual !== 'decision';

/**
 * The whole capability taxonomy, as one object.
 *
 * The tables are module-private and reachable only through this binding: adding
 * a capability is then an edit to this file alone, and no consumer can hold a
 * reference to a table that has drifted from the others.
 */
export const capabilityTables = {
  capabilities: CAPABILITIES,
  primaryRole: PRIMARY_ROLE,
  roleCapability: ROLE_CAPABILITY,
  rolesByCapability: ROLES_BY_CAPABILITY,
  canServeRole,
};

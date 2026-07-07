// packages/shared/types/src/lib/swarm_handoff.ts
/**
 * Swarm agent handoff types — derived from @aikami/schemas SwarmHandoffSchema.
 *
 * These types cross monorepo boundaries (scripts ↔ PI extensions)
 * and follow the schema-first convention.
 */

export type {
  SwarmComplexity,
  SwarmDomain,
  SwarmHandoff,
  SwarmRole,
  SwarmStatus,
} from '@aikami/schemas';

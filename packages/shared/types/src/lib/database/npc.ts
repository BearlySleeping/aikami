// packages/shared/types/src/lib/database/npc.ts
import type { NpcCreateSchema, NpcSchema, NpcUpdateSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type NpcData = Type.Static<typeof NpcSchema>;

export type NpcCreateData = Type.Static<typeof NpcCreateSchema>;

export type NpcUpdateData = Type.Static<typeof NpcUpdateSchema>;

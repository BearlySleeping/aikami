// packages/shared/types/src/lib/database/config.ts
import type { ConfigCreateSchema, ConfigSchema, ConfigUpdateSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type ConfigData = Type.Static<typeof ConfigSchema>;

export type ConfigCreateData = Type.Static<typeof ConfigCreateSchema>;

export type ConfigUpdateData = Type.Static<typeof ConfigUpdateSchema>;

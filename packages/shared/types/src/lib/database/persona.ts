// packages/shared/types/src/lib/database/persona.ts
import type { PersonaCreateSchema, PersonaSchema, PersonaUpdateSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type PersonaData = Type.Static<typeof PersonaSchema>;

export type PersonaCreateData = Type.Static<typeof PersonaCreateSchema>;

export type PersonaUpdateData = Type.Static<typeof PersonaUpdateSchema>;

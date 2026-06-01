// packages/shared/types/src/lib/database/core.ts
import type { CoreCreateSchema, CoreSchema, CoreUpdateSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type CoreData = Type.Static<typeof CoreSchema>;

export type CoreCreateData = Type.Static<typeof CoreCreateSchema>;
export type CoreUpdateData = Type.Static<typeof CoreUpdateSchema>;

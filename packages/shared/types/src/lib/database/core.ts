import type { CoreCreateSchema, CoreSchema, CoreUpdateSchema } from '@aikami/schemas';
import type { z } from 'zod';

export type CoreData = z.infer<typeof CoreSchema>;

export type CoreCreateData = z.infer<typeof CoreCreateSchema>;
export type CoreUpdateData = z.infer<typeof CoreUpdateSchema>;

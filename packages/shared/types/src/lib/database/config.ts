import type { ConfigCreateSchema, ConfigSchema, ConfigUpdateSchema } from '@aikami/schemas';
import type { z } from 'zod';

export type ConfigData = z.infer<typeof ConfigSchema>;

export type ConfigCreateData = z.infer<typeof ConfigCreateSchema>;

export type ConfigUpdateData = z.infer<typeof ConfigUpdateSchema>;

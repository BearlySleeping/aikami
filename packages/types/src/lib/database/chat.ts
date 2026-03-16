import type { ChatCreateSchema, ChatSchema, ChatUpdateSchema } from '@aikami/schemas';
import type { z } from 'zod';

export type ChatData = z.infer<typeof ChatSchema>;

export type ChatCreateData = z.infer<typeof ChatCreateSchema>;

export type ChatUpdateData = z.infer<typeof ChatUpdateSchema>;

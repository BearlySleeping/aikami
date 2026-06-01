// packages/shared/types/src/lib/database/chat.ts
import type { ChatCreateSchema, ChatSchema, ChatUpdateSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type ChatData = Type.Static<typeof ChatSchema>;

export type ChatCreateData = Type.Static<typeof ChatCreateSchema>;

export type ChatUpdateData = Type.Static<typeof ChatUpdateSchema>;

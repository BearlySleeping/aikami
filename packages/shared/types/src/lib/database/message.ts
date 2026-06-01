// packages/shared/types/src/lib/database/message.ts
import type { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type MessageCreateData = Type.Static<typeof MessageCreateSchema>;

export type MessageUpdateData = Type.Static<typeof MessageUpdateSchema>;

export type MessageData = Type.Static<typeof MessageSchema>;

/** biome-ignore-all lint/suspicious/noExplicitAny: Type.Unsafe<any> required for Firestore-specific types */
// packages/shared/schemas/src/lib/database/group_chat.ts
import Type, { Composite } from 'typebox';
import { CoreOmitKeys, CoreSchema } from '../core.ts';
import { getDeletableFields } from '../utils.ts';

const _replyModeUnion = Type.Union([
  Type.Literal('sequential'),
  Type.Literal('random'),
  Type.Literal('simultaneous'),
]);

export const GroupChatSchema = Composite(
  CoreSchema,
  Type.Object({
    uid: Type.String({ description: 'Owner user ID' }),
    name: Type.String({ description: 'Group chat name' }),
    characterIds: Object.assign(Type.Array(Type.String()), {
      description: 'NPC IDs in the group',
      default: [],
    }),
    personaId: Type.Optional(Type.String()),
    lorebookId: Type.Optional(Type.String()),
    replyMode: Object.assign(_replyModeUnion, {
      description: 'How characters respond',
      default: 'sequential',
    }),
  }),
);

export const GroupChatCreateSchema = Type.Intersect([
  Type.Omit(GroupChatSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(Type.Unsafe<any>(Type.Any())) }),
]);

export const GroupChatUpdateSchema = Type.Intersect([
  Type.Omit(GroupChatSchema, [...CoreOmitKeys]),
  Type.Object(getDeletableFields(GroupChatSchema as unknown as Record<string, unknown>)),
  Type.Object({ updatedAt: Type.Unsafe<any>(Type.Any()) }),
]);

export const GroupMessageSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  groupChatId: Type.String({ description: 'Group chat ID' }),
  characterId: Type.String({ description: 'Character who sent this' }),
  sender: Type.Union([Type.Literal('user'), Type.Literal('character')]),
  text: Type.String({ description: 'Message text' }),
  timestamp: Type.String({ format: 'date-time', description: 'Timestamp' }),
});

export type GroupChatData = Type.Static<typeof GroupChatSchema>;
export type GroupChatUpdateData = Type.Static<typeof GroupChatUpdateSchema>;
export type GroupMessageData = Type.Static<typeof GroupMessageSchema>;

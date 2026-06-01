// packages/shared/schemas/src/lib/database/chat.ts
import Type from 'typebox';
import { CoreOmitKeys } from '../core.ts';
import { getDeletableFields } from '../utils.ts';
import { MessageSchema } from './message.ts';

const _visibilityUnion = Type.Union([Type.Literal('private'), Type.Literal('public')]);

export const ChatSchema = Type.Intersect([
  Type.Object({
    id: Type.String(),
    createdAt: Type.Optional(Type.Union([Type.Unsafe<any>(Type.Any()), Type.Null()])),
    updatedAt: Type.Optional(Type.Union([Type.Unsafe<any>(Type.Any()), Type.Null()])),
    priority: Type.Optional(Type.Number()),
  }),
  Type.Object({
    npcId: Type.String({ description: 'ID of the NPC this chat belongs to' }),
    npcName: Type.String({ description: 'Denormalized NPC name for display' }),
    npcAvatarUrl: Type.Optional(Type.String({ description: 'Denormalized NPC avatar URL' })),
    uid: Type.String({ description: 'ID of the user who owns this chat' }),
    visibility: Object.assign(_visibilityUnion, {
      description: 'Chat visibility',
      default: 'private',
    }),
    messages: Object.assign(Type.Array(MessageSchema), { description: 'Array of chat messages' }),
    lastMessageAt: Type.Optional(
      Type.Union([
        Type.Unsafe<any>(Type.Any()),
        Type.Unsafe<any>(Type.Any()),
        Type.Unsafe<any>(Type.Any()),
        Type.Null(),
      ]),
    ),
    messageCount: Type.Number({ description: 'Total number of messages in the chat', default: 0 }),
    affection: Type.Number({ description: 'Affection points with this NPC', default: 0 }),
    stats: Object.assign(
      Type.Optional(
        Type.Object({
          hp: Type.Optional(Type.Number()),
          ac: Type.Optional(Type.Number()),
          level: Type.Optional(Type.Number()),
          class: Type.Optional(Type.String()),
          abilities: Type.Optional(
            Type.Record(
              Type.String(),
              Type.Object({
                score: Type.Number(),
                modifier: Type.Number(),
              }),
            ),
          ),
        }),
      ),
      { default: {} },
    ),
    backgroundImageUrl: Type.Optional(Type.String()),
  }),
]);

export const ChatCreateSchema = Type.Intersect([
  Type.Omit(ChatSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(Type.Unsafe<any>(Type.Any())) }),
]);

export const ChatUpdateSchema = Type.Intersect([
  Type.Omit(ChatSchema, [...CoreOmitKeys]),
  Type.Object(getDeletableFields(ChatSchema as unknown as Record<string, unknown>)),
  Type.Object({ updatedAt: Type.Unsafe<any>(Type.Any()) }),
]);

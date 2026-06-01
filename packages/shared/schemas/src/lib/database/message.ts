// packages/shared/schemas/src/lib/database/message.ts
import Type, { Composite } from 'typebox';
import { CoreOmitKeys, CoreSchema } from '../core.ts';
import { FieldValueSchema, TimestampSchema } from '../fields.ts';
import { getDeletableFields } from '../utils.ts';

const _senderUnion = Type.Union([Type.Literal('user'), Type.Literal('ai')]);
const _attachmentTypeUnion = Type.Union([Type.Literal('image'), Type.Literal('file')]);
const _chatVisibilityUnion = Type.Union([Type.Literal('private'), Type.Literal('public')]);

export const MessageSchema = Composite(
  CoreSchema,
  Type.Object({
    text: Type.String(),
    sender: _senderUnion,
    editedAt: Type.Optional(
      Type.Union([TimestampSchema, Type.Unsafe<any>(Type.Any()), FieldValueSchema]),
    ),
    editedBy: Type.Optional(_senderUnion),
    regeneratedFrom: Type.Optional(
      Type.String({ description: 'ID of the message this was regenerated from' }),
    ),
    attachments: Object.assign(
      Type.Optional(
        Type.Array(
          Type.Object({
            type: _attachmentTypeUnion,
            url: Type.String(),
            name: Type.Optional(Type.String()),
            mimeType: Type.Optional(Type.String()),
            size: Type.Optional(Type.Number()),
          }),
        ),
      ),
      { default: [] },
    ),
    metadata: Object.assign(Type.Optional(Type.Record(Type.String(), Type.Unknown())), {
      default: {},
    }),
    chatOwnerUid: Type.Optional(Type.String()),
    chatVisibility: Type.Optional(_chatVisibilityUnion),
  }),
);

export const MessageCreateSchema = Type.Intersect([
  Type.Omit(MessageSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(FieldValueSchema) }),
  Type.Object({
    editedAt: MessageSchema.properties.editedAt as Type.TSchema,
  }),
]);

export const MessageUpdateSchema = Type.Intersect([
  Type.Omit(MessageSchema, [...CoreOmitKeys]),
  Type.Object(getDeletableFields(MessageSchema as unknown as Record<string, unknown>)),
  Type.Object({ updatedAt: FieldValueSchema }),
  Type.Object({
    editedAt: MessageSchema.properties.editedAt as Type.TSchema,
  }),
]);

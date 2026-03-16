import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { FieldValueSchema, TimestampSchema } from '../fields.ts';
import { getDeletableFields } from '../utils.ts';

export const MessageSchema = CoreSchema.extend({
  text: z.string(),
  sender: z.enum(['user', 'ai']),
  editedAt: TimestampSchema.optional().or(z.date()).or(FieldValueSchema).optional(),
  editedBy: z.enum(['user', 'ai']).optional(),
  regeneratedFrom: z.string().optional().describe('ID of the message this was regenerated from'),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'file']),
        url: z.string(),
        name: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .optional()
    .default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const MessageCreateSchema = MessageSchema.omit(CoreOmitSchema)
  .extend(CoreCreateSchema.shape)
  .extend({
    editedAt: MessageSchema.shape.editedAt,
  });

export const MessageUpdateSchema = MessageSchema.extend(getDeletableFields(MessageSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape)
  .extend({
    editedAt: MessageSchema.shape.editedAt,
  });

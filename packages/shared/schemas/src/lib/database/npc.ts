/** biome-ignore-all lint/suspicious/noExplicitAny: Type.Unsafe<any> required for Firestore-specific types */
// packages/shared/schemas/src/lib/database/npc.ts
import Type, { Composite } from 'typebox';
import { CoreOmitKeys, CoreSchema } from '../core/core.ts';
import { BaseCharacterSheetSchema } from './character.ts';

const _visibilityUnion = Type.Union([Type.Literal('private'), Type.Literal('public')]);

export const NpcSheetSchema = Composite(
  BaseCharacterSheetSchema,
  Type.Object({
    isFriendly: Type.Optional(Type.Boolean({ description: 'Is the NPC friendly?', default: true })),
    faction: Type.Optional(Type.String({ description: 'NPC faction or affiliation' })),
    occupation: Type.Optional(Type.String({ description: 'NPC occupation or job' })),
    personality: Type.Optional(
      Type.String({ description: 'Character personality description for AI roleplay' }),
    ),
    scenario: Type.Optional(Type.String({ description: 'Scenario/world setting for the NPC' })),
    systemPrompt: Type.Optional(Type.String({ description: 'System prompt for AI chat' })),
    firstMessage: Type.Optional(
      Type.String({ description: 'First message the NPC sends in chat' }),
    ),
    creatorUid: Type.Optional(Type.String({ description: 'ID of the user who created this NPC' })),
    visibility: Type.Optional(
      Object.assign(_visibilityUnion, {
        description: 'Visibility of the NPC',
        default: 'private',
      }),
    ),
    forkedFromNpcId: Type.Optional(
      Type.String({ description: 'ID of the original NPC this was forked from' }),
    ),
    expressions: Type.Optional(Type.Record(Type.String(), Type.String({ format: 'uri' }))),
  }),
);

export type NpcSheet = Type.Static<typeof NpcSheetSchema>;
export const NpcSchema = Composite(
  Composite(CoreSchema, NpcSheetSchema),
  Type.Object({
    avatarUrl: Type.Optional(
      Type.String({ format: 'uri', description: 'URL of the character image' }),
    ),
    voiceConfigId: Type.Optional(
      Type.String({ description: 'ID of the voice configuration for TTS' }),
    ),
  }),
);

export type Npc = Type.Static<typeof NpcSchema>;
export const NpcCreateSchema = Type.Intersect([
  Type.Omit(NpcSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(Type.Unsafe<any>(Type.Any())) }),
]);

export type NpcCreate = Type.Static<typeof NpcCreateSchema>;
export const NpcUpdateSchema = Type.Intersect([
  Type.Omit(Type.Partial(NpcSchema), [...CoreOmitKeys]),
  Type.Object({ updatedAt: Type.Unsafe<any>(Type.Any()) }),
]);

export type NpcUpdate = Type.Static<typeof NpcUpdateSchema>;

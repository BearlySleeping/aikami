// packages/shared/schemas/src/lib/api/game.ts
import Type from 'typebox';

export const ActiveSessionSchema = Type.Object({
  id: Type.String(),
  worldId: Type.String(),
  uid: Type.String(),
  characterIds: Type.Array(Type.String(), { default: [] }),
  npcIds: Type.Array(Type.String(), { default: [] }),
  currentLocationId: Type.Optional(Type.String()),
  startedAt: Type.String({ format: 'date-time' }),
  lastActiveAt: Type.String({ format: 'date-time' }),
  isActive: Type.Boolean({ default: true }),
});

export const SceneImageSchema = Type.Object({
  id: Type.String(),
  worldId: Type.String(),
  locationId: Type.String(),
  imageUrl: Type.String({ format: 'uri' }),
  thumbnailUrl: Type.Optional(Type.String({ format: 'uri' })),
  provider: Type.Union([
    Type.Literal('dalle'),
    Type.Literal('stable-diffusion'),
    Type.Literal('comfyui'),
  ]),
  prompt: Type.String(),
  seed: Type.Optional(Type.Number()),
  width: Type.Number(),
  height: Type.Number(),
  createdAt: Type.String({ format: 'date-time' }),
  isActive: Type.Boolean({ default: true }),
});

export const GeneratedAudioSchema = Type.Object({
  id: Type.String(),
  messageId: Type.Optional(Type.String()),
  characterId: Type.Optional(Type.String()),
  audioUrl: Type.String({ format: 'uri' }),
  provider: Type.Union([
    Type.Literal('elevenlabs'),
    Type.Literal('silero'),
    Type.Literal('coqui'),
    Type.Literal('edge'),
  ]),
  voiceId: Type.String(),
  duration: Type.Number(),
  text: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});

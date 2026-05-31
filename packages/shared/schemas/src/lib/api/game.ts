// packages/shared/schemas/src/lib/api/game.ts
import { z } from 'zod';

export const ActiveSessionSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  uid: z.string(),
  characterIds: z.string().array().default([]),
  npcIds: z.string().array().default([]),
  currentLocationId: z.string().optional(),
  startedAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  isActive: z.boolean().default(true),
});

export const SceneImageSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  locationId: z.string(),
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  provider: z.enum(['dalle', 'stable-diffusion', 'comfyui']),
  prompt: z.string(),
  seed: z.number().optional(),
  width: z.number(),
  height: z.number(),
  createdAt: z.string().datetime(),
  isActive: z.boolean().default(true),
});

export const GeneratedAudioSchema = z.object({
  id: z.string(),
  messageId: z.string().optional(),
  characterId: z.string().optional(),
  audioUrl: z.string().url(),
  provider: z.enum(['elevenlabs', 'silero', 'coqui', 'edge']),
  voiceId: z.string(),
  duration: z.number(),
  text: z.string(),
  createdAt: z.string().datetime(),
});

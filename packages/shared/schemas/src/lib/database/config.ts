/** biome-ignore-all lint/suspicious/noExplicitAny: Type.Unsafe<any> required for Firestore-specific types */
// packages/shared/schemas/src/lib/database/config.ts
import Type, { Composite } from 'typebox';
import { getDeletableFields } from '../common/utils.ts';
import { CoreOmitKeys, CoreSchema } from '../core/core.ts';

const _themeUnion = Type.Union([
  Type.Literal('dark'),
  Type.Literal('light'),
  Type.Literal('system'),
]);

const _gameDifficultyUnion = Type.Union([
  Type.Literal('easy'),
  Type.Literal('normal'),
  Type.Literal('hard'),
]);

export const ConfigSchema = Composite(
  CoreSchema,
  Type.Object({
    uid: Type.String({ description: 'User ID — matches the document ID and Firebase Auth uid' }),
    theme: Type.Optional(
      Object.assign(_themeUnion, { description: 'UI theme preference', default: 'system' }),
    ),
    locale: Type.Optional(
      Type.String({
        description: 'ISO 639-1 language code (e.g., en, da, es)',
        default: 'en',
      }),
    ),
    notificationsEnabled: Type.Optional(
      Type.Boolean({
        description: 'Whether push notifications are enabled',
        default: true,
      }),
    ),
    soundEnabled: Type.Optional(
      Type.Boolean({
        description: 'Whether sound effects and audio are enabled',
        default: true,
      }),
    ),
    gameDifficulty: Type.Optional(
      Object.assign(_gameDifficultyUnion, {
        description: 'Game difficulty setting',
        default: 'normal',
      }),
    ),
    autoSave: Type.Optional(
      Type.Boolean({
        description: 'Whether game progress auto-saves to cloud',
        default: true,
      }),
    ),
    showTutorial: Type.Optional(
      Type.Boolean({
        description: 'Whether to show tutorial on next launch',
        default: true,
      }),
    ),
  }),
);

export type Config = Type.Static<typeof ConfigSchema>;
export const ThemeSchema = _themeUnion;

export type Theme = Type.Static<typeof ThemeSchema>;
export const GameDifficultySchema = _gameDifficultyUnion;

export type GameDifficulty = Type.Static<typeof GameDifficultySchema>;
export const ConfigCreateSchema = Type.Intersect([
  Type.Omit(ConfigSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(Type.Unsafe<any>(Type.Any())) }),
]);

export type ConfigCreate = Type.Static<typeof ConfigCreateSchema>;
export const ConfigUpdateSchema = Type.Intersect([
  Type.Omit(ConfigSchema, [...CoreOmitKeys]),
  Type.Object(getDeletableFields(ConfigSchema as unknown as Record<string, unknown>)),
  Type.Object({ updatedAt: Type.Unsafe<any>(Type.Any()) }),
]);

export type ConfigUpdate = Type.Static<typeof ConfigUpdateSchema>;

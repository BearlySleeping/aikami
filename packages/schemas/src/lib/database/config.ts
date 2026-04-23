import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { getDeletableFields } from '../utils.ts';

export const ThemeSchema = z
  .enum(['dark', 'light', 'system'])
  .describe('UI theme preference')
  .default('system');

export const GameDifficultySchema = z
  .enum(['easy', 'normal', 'hard'])
  .describe('Game difficulty setting')
  .default('normal');

export const ConfigSchema = CoreSchema.extend({
  uid: z.string().describe('User ID — matches the document ID and Firebase Auth uid'),
  theme: ThemeSchema,
  locale: z.string().describe('ISO 639-1 language code (e.g., en, da, es)').default('en'),
  notificationsEnabled: z
    .boolean()
    .describe('Whether push notifications are enabled')
    .default(true),
  soundEnabled: z.boolean().describe('Whether sound effects and audio are enabled').default(true),
  gameDifficulty: GameDifficultySchema,
  autoSave: z.boolean().describe('Whether game progress auto-saves to cloud').default(true),
  showTutorial: z.boolean().describe('Whether to show tutorial on next launch').default(true),
});

export const ConfigCreateSchema = ConfigSchema.omit(CoreOmitSchema).extend(CoreCreateSchema.shape);

export const ConfigUpdateSchema = ConfigSchema.extend(getDeletableFields(ConfigSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);

// packages/shared/schemas/src/lib/project.ts

import { MODE_PROJECT_MAP, modes } from '@aikami/constants';
import Type from 'typebox';

/**
 * TypeBox schema for Aikami deployment mode.
 * modes = ['development', 'production', 'emulator'] as const
 */
export const ModeSchema = Type.Union([
  Type.Literal('development'),
  Type.Literal('production'),
  Type.Literal('emulator'),
]);

/**
 * TypeBox schema for Firebase/GCP project IDs.
 * Derived from MODE_PROJECT_MAP values.
 */
export const ProjectIdSchema = Type.Union(
  Object.values(MODE_PROJECT_MAP).map((id) => Type.Literal(id)) as unknown as [
    ReturnType<typeof Type.Literal>,
    ...ReturnType<typeof Type.Literal>[],
  ],
);

/**
 * The mapped project IDs as a schema.
 */
export const ProjectIdMapSchema = Type.Object(
  Object.fromEntries(modes.map((mode) => [mode, Type.Literal(MODE_PROJECT_MAP[mode])])) as Record<
    string,
    ReturnType<typeof Type.Literal>
  >,
);

// appIds, backendAppIds, frontendAppIds are spread from constants
// backendAppIds = ['firebase'] as const
// frontendAppIds = ['docs', 'game', 'landing_page', 'pwa'] as const
export const AppIdSchema = Type.Union([
  Type.Literal('firebase'),
  Type.Literal('docs'),
  Type.Literal('game'),
  Type.Literal('landing_page'),
  Type.Literal('pwa'),
]);

export const BackendAppIdSchema = Type.Union([Type.Literal('firebase')]);

export const FrontendAppIdSchema = Type.Union([
  Type.Literal('docs'),
  Type.Literal('game'),
  Type.Literal('landing_page'),
  Type.Literal('pwa'),
]);

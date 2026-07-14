// packages/shared/schemas/src/lib/project.ts

import { MODE_PROJECT_MAP, modes } from '@aikami/constants';
import Type from 'typebox';

/**
 * TypeBox schema for Aikami deployment mode.
 * modes = ['staging', 'production', 'emulator'] as const
 */
export const ModeSchema = Type.Union([
  Type.Literal('staging'),
  Type.Literal('production'),
  Type.Literal('emulator'),
  Type.Literal('testing'),
]);

export type Mode = Type.Static<typeof ModeSchema>;
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

export type ProjectId = Type.Static<typeof ProjectIdSchema>;
/**
 * The mapped project IDs as a schema.
 */
export const ProjectIdMapSchema = Type.Object(
  Object.fromEntries(modes.map((mode) => [mode, Type.Literal(MODE_PROJECT_MAP[mode])])) as Record<
    string,
    ReturnType<typeof Type.Literal>
  >,
);

export type ProjectIdMap = Type.Static<typeof ProjectIdMapSchema>;
// appIds, backendAppIds, frontendAppIds are spread from constants
// backendAppIds = ['firebase'] as const
// frontendAppIds = ['docs', 'site', 'client'] as const
export const AppIdSchema = Type.Union([
  Type.Literal('firebase'),
  Type.Literal('docs'),
  Type.Literal('site'),
  Type.Literal('client'),
]);

export type AppId = Type.Static<typeof AppIdSchema>;
export const BackendAppIdSchema = Type.Union([Type.Literal('firebase')]);

export type BackendAppId = Type.Static<typeof BackendAppIdSchema>;
export const FrontendAppIdSchema = Type.Union([
  Type.Literal('docs'),
  Type.Literal('site'),
  Type.Literal('client'),
]);

export type FrontendAppId = Type.Static<typeof FrontendAppIdSchema>;

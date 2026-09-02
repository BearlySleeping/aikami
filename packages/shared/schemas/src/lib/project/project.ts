// packages/shared/schemas/src/lib/project.ts

import { MODE_PROJECT_MAP, modes } from '@aikami/constants';
import Type from 'typebox';

// TypeBox's Static inference needs a literal TUPLE inside Type.Union, not
// an array — `.map()` on a const tuple widens to T[] and Static collapses
// to `never`. This recursive tuple helper preserves the literal order (see
// packages/shared/schemas/src/lib/local_ai/stack_backend.ts for the same
// pattern).
type LiteralTupleOf<T extends readonly string[]> = T extends readonly [
  infer First extends string,
  ...infer Rest extends string[],
]
  ? [ReturnType<typeof Type.Literal<First>>, ...LiteralTupleOf<Rest>]
  : [];

const modeSchemas = modes.map((mode) => Type.Literal(mode)) as LiteralTupleOf<typeof modes>;

/**
 * TypeBox schema for Aikami deployment mode.
 * Derived from `modes` (packages/shared/constants) so disabling a mode there
 * (e.g. commenting out staging in `modes` + MODE_PROJECT_MAP) shrinks this
 * union too.
 */
export const ModeSchema = Type.Union(modeSchemas);

export type Mode = Type.Static<typeof ModeSchema>;
/**
 * TypeBox schema for Firebase/GCP project IDs.
 * Derived from MODE_PROJECT_MAP values.
 */
export const ProjectIdSchema = Type.Union(
  Object.values(MODE_PROJECT_MAP).map((id) => Type.Literal(id)) as unknown as [
    // guard-ignore lint/type-safety/casting: TypeBox type system limitation - TSchema not assignable to Record<string, unknown>
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
// backendAppIds = ['image', 'text', 'voice', 'worker'] as const
// frontendAppIds = ['docs', 'site', 'client', 'client-tauri', 'hub'] as const
// 'database' and 'storage' belong to NEITHER — they are the migration-deploy
// apps (C-394 AC-5, C-455), not backend services or frontend apps.
export const AppIdSchema = Type.Union([
  Type.Literal('image'),
  Type.Literal('text'),
  Type.Literal('voice'),
  Type.Literal('worker'),
  Type.Literal('docs'),
  Type.Literal('site'),
  Type.Literal('client'),
  Type.Literal('client-tauri'),
  Type.Literal('hub'),
  Type.Literal('database'),
  Type.Literal('storage'),
]);

export type AppId = Type.Static<typeof AppIdSchema>;
export const BackendAppIdSchema = Type.Union([
  Type.Literal('image'),
  Type.Literal('text'),
  Type.Literal('voice'),
  Type.Literal('worker'),
]);

export type BackendAppId = Type.Static<typeof BackendAppIdSchema>;
export const FrontendAppIdSchema = Type.Union([
  Type.Literal('docs'),
  Type.Literal('site'),
  Type.Literal('client'),
  Type.Literal('client-tauri'),
  Type.Literal('hub'),
]);

export type FrontendAppId = Type.Static<typeof FrontendAppIdSchema>;

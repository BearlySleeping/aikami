// packages/shared/types/src/lib/project.ts
import type {
  AppIdSchema,
  BackendAppIdSchema,
  FrontendAppIdSchema,
  ModeSchema,
} from '@aikami/schemas';
import type { Type } from 'typebox';

/** Nordclaw deployment mode type inferred from the shared schema. */
export type Mode = Type.Static<typeof ModeSchema>;

/** Nordclaw application identifier (backend + frontend). */
export type AppId = Type.Static<typeof AppIdSchema>;

/** Nordclaw backend application identifier. */
export type BackendAppId = Type.Static<typeof BackendAppIdSchema>;

/** Nordclaw frontend application identifier. */
export type FrontendAppId = Type.Static<typeof FrontendAppIdSchema>;

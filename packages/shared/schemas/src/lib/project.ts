// packages/shared/schemas/src/lib/project.ts

import { appIds, backendAppIds, frontendAppIds, MODE_PROJECT_MAP, modes } from '@aikami/constants';
import { z } from 'zod';

/**
 * Zod schema for Aikami deployment mode.
 * Validates against the shared modes from constants.
 */
export const ModeSchema = z.enum(modes);

/**
 * Zod schema for Firebase/GCP project IDs.
 */
export const ProjectIdSchema = z.enum(Object.values(MODE_PROJECT_MAP) as [string, ...string[]]);

/**
 * The mapped project IDs as a schema — validates that a mode maps to a real project ID.
 */
export const ProjectIdMapSchema = z.object(
  Object.fromEntries(modes.map((mode) => [mode, z.literal(MODE_PROJECT_MAP[mode])])) as Record<
    (typeof modes)[number],
    z.ZodLiteral<string>
  >,
);

/**
 * Zod schema for all Aikami app identifiers (backend + frontend).
 * @see {@link backendAppIds} and {@link frontendAppIds} in @aikami/constants
 */
export const AppIdSchema = z.enum(appIds);

/**
 * Zod schema for Aikami backend app identifiers.
 * Covers Cloud Run services and Firebase Functions.
 */
export const BackendAppIdSchema = z.enum(backendAppIds);

/**
 * Zod schema for Aikami frontend app identifiers.
 * Covers SvelteKit PWAs, landing page, docs, and game engine.
 */
export const FrontendAppIdSchema = z.enum(frontendAppIds);

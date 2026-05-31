import type {
  AppIdSchema,
  BackendAppIdSchema,
  FrontendAppIdSchema,
  ModeSchema,
} from '@aikami/schemas';
import type { z } from 'zod';

/**
 * Nordclaw deployment mode type inferred from the shared schema.
 */
export type Mode = z.infer<typeof ModeSchema>;

/**
 * Nordclaw application identifier (backend + frontend).
 */
export type AppId = z.infer<typeof AppIdSchema>;

/**
 * Nordclaw backend application identifier.
 * Covers Cloud Run services (`audit-worker`, `edge-proxy`) and Firebase Functions (`firebase`).
 */
export type BackendAppId = z.infer<typeof BackendAppIdSchema>;

/**
 * Nordclaw frontend application identifier.
 * Covers SvelteKit PWAs (`admin`, `pwa`), the Astro landing page (`landing`),
 * and the Chrome browser extension (`extension`).
 */
export type FrontendAppId = z.infer<typeof FrontendAppIdSchema>;

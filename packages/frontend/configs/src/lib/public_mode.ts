// packages/frontend/configs/src/lib/public_mode.ts
//
// The single public-mode "development" predicate shared by the client, the hub
// and the engine's dev-only diagnostics.
//
// `PUBLIC_MODE` is Aikami's deployment-target selector (see
// `packages/shared/constants/src/lib/project.ts`). Every recognized mode except
// `production` is a development/test target where dev-only surfaces may appear.
// The predicate is FAIL-CLOSED: an unset or unrecognized mode is NOT
// development, so a misconfigured build cannot accidentally enable a debug
// overlay. This replaces the earlier `PUBLIC_MODE !== 'production'` check,
// which treated `undefined`/unknown values as development.

import { modes } from '@aikami/constants';

/** Recognized deployment modes that are not production. */
const DEVELOPMENT_MODES: ReadonlySet<string> = new Set(
  modes.filter((mode) => mode !== 'production'),
);

/** True when `mode` is a recognized non-production deployment mode. */
export const isDevelopmentMode = (mode: string | undefined): boolean =>
  mode !== undefined && DEVELOPMENT_MODES.has(mode);

/** True only for the repository's recognized non-production public modes. */
export const isDevelopmentModePublic = (): boolean => {
  const mode = (import.meta.env as unknown as Record<string, string | undefined>).PUBLIC_MODE; // guard-ignore lint/type-safety/casting: import.meta.env access - env var types are dynamic at build time
  return isDevelopmentMode(mode);
};

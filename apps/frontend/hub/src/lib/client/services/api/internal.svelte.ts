// apps/frontend/hub/src/lib/client/services/api/internal.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { treaty } from '@elysiajs/eden';
import type { App } from '$lib/server/api';

/**
 * Typed client for the internal API service (Elysia + TypeBox).
 * The `App` type is imported type-only from the server module so no
 * server code is bundled into the client — the type is erased at build.
 *
 * The base URL is the current origin: the Elysia app is mounted under
 * `/api` (prefix), and Eden appends the route path to the domain, so a
 * relative/empty domain would be misparsed (e.g. host 'api').
 */
export const api = treaty<App>(typeof window !== 'undefined' ? window.location.origin : '');

export type InternalAPIServiceOptions = BaseFrontendClassOptions;

export type InternalAPIServiceInterface = BaseFrontendClassInterface;

class InternalAPIService
  extends BaseFrontendClass<InternalAPIServiceOptions>
  implements InternalAPIServiceInterface {}

export const internalAPIService: InternalAPIServiceInterface = InternalAPIService.create({
  className: 'InternalAPIService',
});

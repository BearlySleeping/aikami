// packages/frontend/services/src/router.ts
//
// Narrow, import-safe public entrypoint for the router service.
//
// The package root (`@aikami/frontend/services`) aggregates router, dialog,
// R2 and preference modules as side effects. Consumers that only need
// `routerService`/`RouterServiceInterface` import this subpath so the rest of
// the application graph is not loaded. Test path aliases mirror `./base` and
// `./r2_storage`.

export * from './lib/services/router.svelte.ts';

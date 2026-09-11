// packages/frontend/services/src/dialog.ts
//
// Narrow, import-safe public entrypoint for the dialog service.
//
// The package root (`@aikami/frontend/services`) aggregates router, dialog,
// R2 and preference modules as side effects. Consumers that only need
// `dialogService`/`DialogServiceInterface` import this subpath so the rest of
// the application graph is not loaded. Test path aliases mirror `./base` and
// `./r2_storage`.

export * from './lib/services/dialog.svelte.ts';

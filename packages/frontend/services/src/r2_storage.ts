// packages/frontend/services/src/r2_storage.ts
//
// Narrow, import-safe public entrypoint for the R2 storage driver.
//
// The package root (`@aikami/frontend/services`) aggregates router, dialog,
// R2 and preference modules as side effects. Consumers that only need
// `createR2Storage`/`R2StorageInterface` import this subpath so no application
// graph is loaded. Test path aliases mirror `./base`, resolving the subpath to
// a file at the package `src` root.

export * from './lib/services/r2_storage.ts';

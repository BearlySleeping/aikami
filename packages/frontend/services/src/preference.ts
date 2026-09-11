// packages/frontend/services/src/preference.ts
//
// Narrow, import-safe public entrypoint for the preference provider hierarchy.
//
// The package root (`@aikami/frontend/services`) aggregates router, dialog,
// R2 and preference modules as side effects. Consumers that only need
// `CorePreferenceProviderService`/`PreferenceService` import this subpath so
// the rest of the application graph is not loaded. Test path aliases mirror
// `./base` and `./r2_storage`.

export * from './lib/base/preference/index.ts';

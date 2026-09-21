// packages/frontend/services/src/base.ts
//
// Narrow, import-safe public entrypoint for the base class hierarchy.
//
// Importing the package root (`@aikami/frontend/services`) pulls in router,
// dialog, R2 and preference aggregation as module side effects. Test code and
// framework-agnostic consumers that only need `BaseClass`/`BaseViewModel`/
// `BaseFormViewModel` should import this subpath instead, so no application
// graph is loaded just to construct a class.
//
// Keep this file free of runtime imports beyond the base directory. Platform
// aggregation belongs on the package root.

export * from './lib/base/base_dev_view_model.svelte.ts';
export * from './lib/base/base_form_model.svelte.ts';
export * from './lib/base/base_frontend_class.ts';
export * from './lib/base/base_view_model.svelte.ts';
export * from './lib/base/dialog_capabilities.ts';

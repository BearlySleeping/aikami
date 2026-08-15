// packages/backend/database/src/index.ts
//
// C-394: server data plane package barrel.
//
// 🔴 I-1: this package is SERVER-ONLY. Import it only from `src/lib/server/`
// in the hub (or Node contexts like the deploy scripts). A client-bundle
// import must fail loudly at build time — enforced by the I-1 bundle guard
// (AC-4.1) — so no database credential ever reaches a browser.

export * from './lib/connection.ts';
export * from './lib/migrate.ts';
export * from './lib/repositories/index.ts';
export * from './lib/schema.ts';

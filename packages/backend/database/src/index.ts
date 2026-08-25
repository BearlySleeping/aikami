// packages/backend/database/src/index.ts
//
// C-436: server data plane package barrel — D1 (sqlite) schema only.
// The Postgres schema (pg-core) and its repositories were removed in C-436.
//
// 🔴 I-1: this package is SERVER-ONLY. Import it only from `src/lib/server/`
// in the hub (or Node contexts like the deploy scripts). A client-bundle
// import must fail loudly at build time — enforced by the I-1 bundle guard
// (AC-4.1) — so no database credential ever reaches a browser.

export * from './lib/schema.ts';

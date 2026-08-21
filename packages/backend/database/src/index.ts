// packages/backend/database/src/index.ts
//
// C-394: server data plane package barrel.
//
// 🔴 I-1: this package is SERVER-ONLY. Import it only from `src/lib/server/`
// in the hub (or Node contexts like the deploy scripts). A client-bundle
// import must fail loudly at build time — enforced by the I-1 bundle guard
// (AC-4.1) — so no database credential ever reaches a browser.

export * from './lib/connection.ts';
// C-426: the D1 (sqlite) schema is exported under the `d1` namespace to avoid
// colliding with the still-live Postgres schema's `packs`/`packVersions`/
// `accounts` exports (both stay in the tree until the AC-8 decommission).
export * as d1 from './lib/d1_schema.ts';
export * from './lib/repositories/index.ts';
export * from './lib/schema.ts';

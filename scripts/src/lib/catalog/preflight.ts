// scripts/src/lib/catalog/preflight.ts
//
// C-395 AC-4 attribution preflight — now implemented in `@aikami/schemas`
// (C-513) so the hub can run the same discipline on community-asset
// submissions. The hub imports only `@aikami/*` packages and cannot reach
// `scripts/`, so the single implementation lives in the shared package and
// this module re-exports it. No behaviour change.

export {
  type PreflightEntry,
  type PreflightResult,
  type PreflightRightsEvidence,
  runAttributionPreflight,
} from '@aikami/schemas';

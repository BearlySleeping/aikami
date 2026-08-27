// packages/frontend/engine/src/node.ts
// ---------------------------------------------------------------------------
// Node subpath — filesystem I/O, Turso database hydration
// These modules import node:* or @tursodatabase/database and must stay off
// the browser bundle.
// ---------------------------------------------------------------------------

// Asset manifest node operations (filesystem scanning, disk I/O)
export {
  buildManifest,
  ensureAssetDirs,
  loadManifest,
} from './assets/asset_manifest_node.ts';

// Turso registry hydration (C-195)
export { TursoRegistryHydration } from './persistence/turso_registry_hydration.ts';

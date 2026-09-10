// packages/shared/constants/src/lib/dev_services.ts
//
// Canonical Aikami dev-service identities.
//
// 🔴 SINGLE SOURCE OF TRUTH for the set of herdr-managed dev services. Lives
// in the shared constants package (not scripts/src/lib/herdr/session.ts)
// because both the Bun-side herdr scripts and the Node-side pi extensions
// need the same list: the extension advertises the valid service names in its
// tool schema at registration time, before any bridge subprocess can run.
//
// The behavioral definitions (commands, ports, probes) stay in
// scripts/src/lib/herdr/session.ts — this module carries only the names.

/** Canonical service names (used internally). */
export type DevService =
  | 'client'
  | 'hub'
  | 'hub-worker'
  | 'voice'
  | 'image'
  | 'text'
  | 'text-ollama'
  | 'image-comfyui'
  | 'preview-client'
  | 'site'
  | 'preview-site'
  | 'preview-hub'
  | 'tauri';

/** Services started by the `all` group. */
export const ALL_SERVICES: DevService[] = [
  'client',
  'hub',
  'voice',
  'image',
  'text',
  'preview-client',
  'site',
  'preview-site',
  'preview-hub',
  'tauri',
];

/**
 * All valid service names — superset of {@link ALL_SERVICES}. Used for CLI
 * validation and `herdr:list`. The C-392 advanced engines (text-ollama,
 * image-comfyui) are fully manageable even though they are NOT in `all`.
 */
export const KNOWN_SERVICES: DevService[] = [
  ...ALL_SERVICES,
  'text-ollama',
  'image-comfyui',
  'hub-worker',
];

// apps/frontend/client/src/lib/services/assets/registry_asset_resolver.ts
//
// Registry-backed AssetResolver (C-444) — the client's implementation of the
// resolve/release seam consumed by @aikami/frontend/preview
// (createLpcRenderer, PreviewProps.resolver) and the LPC asset catalog.
//
// Resolves catalog tags through the AssetStore (cache → R2 → bundled static
// path) and releases refcounted blob URLs through the AssetManager. The hub
// has a separate content-addressed CDN implementation of the same interface
// — see AssetResolver's doc comment in @aikami/types.

import type { AssetResolver } from '@aikami/types';
import { assetManager } from './asset_manager.svelte.ts';
import { assetStore } from './asset_store.svelte.ts';

/**
 * Creates a registry-backed {@link AssetResolver}.
 *
 * Every call shares the same underlying AssetStore/AssetManager state — the
 * factory exists so each call site (LPC renderer, walk sandbox, map sandbox,
 * ...) owns its own resolver reference, matching the
 * `createLpcRenderer({ resolver })` / `PreviewProps.resolver` seam. Callers
 * must ensure the asset manifest is loaded (`assetStore.fetchManifest()`)
 * before `resolve` can return anything other than null.
 */
export const createRegistryAssetResolver = (): AssetResolver => ({
  resolve: (tag) => assetStore.resolveUrl(tag),
  release: (url) => assetManager.releaseUrl(url),
  kind: 'registry',
});

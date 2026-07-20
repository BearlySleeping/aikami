// apps/frontend/client/src/lib/services/campaign/pack_registry_service.svelte.ts
//
// Content pack registry service — discovers installed packs from
// /content-packs/index.json and exposes reactive availablePacks state
// to the ViewModel layer.
// Contract: C-345 Add a Campaign/Content-Pack Browser and a Second Adventure

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { PackIndexSchema } from '@aikami/schemas';
import type { PackIndexEntry } from '@aikami/types';
import { Value } from 'typebox/value';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PackRegistryServiceInterface = BaseFrontendClassInterface & {
  /** All installed content packs with cached metadata. */
  readonly availablePacks: readonly PackIndexEntry[];
  /** Whether the pack index is currently being fetched. */
  readonly isLoading: boolean;
  /** Error message if pack index fetch failed, or undefined. */
  readonly lastError: string | undefined;

  /** Fetches and validates the pack index from /content-packs/index.json. */
  refresh(): Promise<void>;
  /** Returns a pack index entry by ID, or undefined. */
  getPack(packId: string): PackIndexEntry | undefined;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class PackRegistryService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements PackRegistryServiceInterface
{
  availablePacks: PackIndexEntry[] = $state([]);
  isLoading = $state(false);
  lastError = $state<string | undefined>(undefined);

  /** Cached refresh Promise to deduplicate concurrent refresh calls. */
  private _refreshPromise: Promise<void> | undefined = undefined;

  /** @inheritdoc */
  async refresh(): Promise<void> {
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this.isLoading = true;
    this.lastError = undefined;

    this._refreshPromise = (async () => {
      try {
        const response = await fetch('/content-packs/index.json');

        if (!response.ok) {
          this.warn('refresh:fetch-failed', { status: response.status });
          this.lastError = `Failed to load pack index (HTTP ${response.status})`;
          this.availablePacks = [];
          return;
        }

        const raw: unknown = await response.json();

        if (!Value.Check(PackIndexSchema, raw)) {
          const errors = [...Value.Errors(PackIndexSchema, raw)];
          const firstError = errors.length > 0 ? String(errors[0].message) : 'unknown';
          this.warn('refresh:validation-failed', { errorCount: errors.length, firstError });
          this.lastError = `Pack index is invalid: ${firstError}`;
          this.availablePacks = [];
          return;
        }

        this.availablePacks = (raw as { packs: PackIndexEntry[] }).packs;
        this.debug('refresh', { packCount: this.availablePacks.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.warn('refresh:error', { error: message });
        this.lastError = `Failed to load pack index: ${message}`;
        this.availablePacks = [];
      } finally {
        this.isLoading = false;
        this._refreshPromise = undefined;
      }
    })();

    return this._refreshPromise;
  }

  /** @inheritdoc */
  getPack(packId: string): PackIndexEntry | undefined {
    return this.availablePacks.find((p) => p.id === packId);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const packRegistryService: PackRegistryServiceInterface = PackRegistryService.create({
  className: 'PackRegistryService',
});

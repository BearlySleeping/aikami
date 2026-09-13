// apps/frontend/client/src/lib/types/community_assets.ts
//
// C-513 — community asset capability types.
//
// These live in `$types` rather than beside the services that use them: they
// describe the *seams* the community browse/import/publish paths are built
// from (an injected hub transport, an injected cache, the outcomes the UI
// renders), and nothing about them is a service implementation detail. Keeping
// them here is also what keeps the service modules to their permitted exports
// (business logic, their own interface/options, and the singleton) — see
// `guard-orphaned-capability`, which treats an export referenced only from type
// positions as having no production caller.
//
// Contract: C-513 End-User Asset Publishing and Community Sharing

import type {
  CommunityAssetImportResult,
  CommunityAssetRegistration,
} from '@aikami/frontend/storage';
import type { CommunityAssetProvenanceProjection, CommunityAssetSummary } from '@aikami/types';

/** The hub transport the browse, import and publish paths all need. */
export type CommunityHubTransport = {
  /** The hub API base (mode-aware), e.g. `https://hub.bearlysleeping.com/api`. */
  hubBaseUrl: string;
  /** Session/bearer headers for the owner-scoped calls (never for browse). */
  authHeaders: () => Record<string, string>;
  /** `fetch` (injected so tests can stub the hub). */
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

/** The seams the *import* path additionally needs. */
export type CommunityAssetImportDeps = CommunityHubTransport & {
  /** Content-hash verification, identical to the generated-asset path. */
  hashBytes: (bytes: Uint8Array) => Promise<string>;
  /** The shared content-hash cache. */
  cache: {
    has(hash: string): Promise<boolean>;
    put(options: { hash: string; blob: Blob }): Promise<void>;
    /** Rolls back a cache write when the registry commit fails. */
    remove(hash: string): Promise<void>;
  };
  /**
   * Writes the registry row. Injected as a callback rather than a database
   * handle so this module never touches the local DB directly — the asset
   * manager owns that seam (`AssetRegistryRepository.registerCommunity`).
   */
  register(asset: CommunityAssetRegistration): Promise<CommunityAssetImportResult>;
  /**
   * Whether any registry row still references a content hash. Used to decide
   * whether a failed registration may safely evict the bytes it just cached.
   */
  hasRegistryReference(hash: string): Promise<boolean>;
  /** Debug logger. */
  debug?: (message: string, context: Record<string, unknown>) => void;
};

/** The transport plus the hub base every publish call targets. */
export type CommunityPublishDeps = CommunityHubTransport;

/** One page of the hub's public community listing. */
export type CommunityBrowsePage = {
  items: readonly CommunityAssetSummary[];
  nextCursor?: string;
};

/**
 * One asset this device already owns from the community namespace (C-513
 * AC-10).
 *
 * Read from the local registry only — the boot-seed manifest is a build
 * artifact and can never contain an imported tag.
 */
export type CommunityLibraryEntry = {
  /** Resolver tag the import registered. */
  tag: string;
  /** Registry category (`sprites`, `music`, …). */
  category: string;
  /** SPDX identifier carried through from the published asset. */
  license?: string;
  /** Attribution / provenance source carried through. */
  attribution?: string;
};

/** Outcome of importing one community asset. */
export type CommunityImportOutcome =
  | { imported: true; tag: string; sha256: string; unchanged: boolean }
  | {
      imported: false;
      tag: string;
      reason: string;
      collision?: CommunityAssetImportResult['collision'];
    };

/**
 * What the user asked to publish.
 *
 * Rights are deliberately absent: the hub resolves the distribution decision
 * from server-owned evidence, so a request body can never grant itself
 * permission (C-513 AC-7).
 */
export type CommunityPublishRequest = {
  /** Resolver tag (must match the AssetRef tag shape). */
  tag: string;
  /** The asset's registry category (a CatalogCategory). */
  category: string;
  title: string;
  /** Extension including the dot, lowercase. */
  ext: string;
  /** Redacted provenance projection — never prompts or local paths. */
  provenance: CommunityAssetProvenanceProjection;
  /** Optional explicit slug; the hub derives one from the title otherwise. */
  slug?: string;
};

/** The publish outcome the UI renders. */
export type CommunityPublishOutcome =
  | {
      published: true;
      slug: string;
      revision: number;
      sha256: string;
      moderationState: 'pending';
      deliveryUrl: string;
    }
  | {
      published: false;
      reason: string;
      /** Scopes the rights gate found unmet, when the refusal was scope-related. */
      missing?: readonly string[];
      message?: string;
    };

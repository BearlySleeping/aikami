// apps/frontend/client/src/lib/services/assets/community_asset_capabilities.ts
//
// C-513 app-local contracts for the community asset service capability.

import type {
  CommunityAssetImportResult,
  CommunityAssetRegistration,
} from '@aikami/frontend/storage';
import type { CommunityAssetProvenanceProjection, CommunityAssetSummary } from '@aikami/types';

/** Hub transport shared by community browse, import and publish operations. */
export type CommunityHubTransport = {
  hubBaseUrl: string;
  authHeaders(): Record<string, string>;
  fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

/** Dependencies required by the community import capability. */
export type CommunityAssetImportDeps = CommunityHubTransport & {
  hashBytes(bytes: Uint8Array): Promise<string>;
  cache: {
    has(hash: string): Promise<boolean>;
    put(options: { hash: string; blob: Blob }): Promise<void>;
    remove(hash: string): Promise<void>;
  };
  register(asset: CommunityAssetRegistration): Promise<CommunityAssetImportResult>;
  hasRegistryReference(hash: string): Promise<boolean>;
  debug?(message: string, context: Record<string, unknown>): void;
};

/** Dependencies required by the community publish capability. */
export type CommunityPublishDeps = CommunityHubTransport;

/** One page of approved community assets. */
export type CommunityBrowsePage = {
  items: readonly CommunityAssetSummary[];
  nextCursor?: string;
};

/** One community asset already owned by this device. */
export type CommunityLibraryEntry = {
  tag: string;
  category: string;
  license?: string;
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

/** Metadata supplied by the local publishing workflow. */
export type CommunityPublishRequest = {
  tag: string;
  category: string;
  title: string;
  ext: string;
  provenance: CommunityAssetProvenanceProjection;
  slug?: string;
};

/** Outcome rendered by the local publishing workflow. */
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
      missing?: readonly string[];
      message?: string;
    };

// apps/frontend/client/src/lib/services/game/game_content_identity.ts

import type { ContentIdentitySnapshot } from '@aikami/types';

type LoadedContentMetadata = {
  manifestAssetSha256?: string;
  releaseId?: string;
  releaseSource?: string;
  packLockSource?: string;
  lockedAssetCount?: number;
};

/** Publishes validated manifest identity with optional release/pack-lock metadata. */
export const publishLoadedContentIdentity = (options: {
  identity: ContentIdentitySnapshot;
  metadata: LoadedContentMetadata;
  publish: (identity: ContentIdentitySnapshot) => void;
}): void => {
  options.publish({
    ...options.identity,
    ...(options.metadata.manifestAssetSha256 === undefined
      ? {}
      : { manifestAssetSha256: options.metadata.manifestAssetSha256 }),
    ...(options.metadata.releaseId === undefined ? {} : { releaseId: options.metadata.releaseId }),
    ...(options.metadata.releaseSource === undefined
      ? {}
      : { releaseSource: options.metadata.releaseSource }),
    ...(options.metadata.packLockSource === undefined
      ? {}
      : { packLockSource: options.metadata.packLockSource }),
    ...(options.metadata.lockedAssetCount === undefined
      ? {}
      : { lockedAssetCount: options.metadata.lockedAssetCount }),
  });
};

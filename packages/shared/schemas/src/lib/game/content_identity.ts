// packages/shared/schemas/src/lib/game/content_identity.ts

import Type from 'typebox';

/** Browser-observed content identity used by development diagnostics and evidence. */
export const ContentIdentitySnapshotSchema = Type.Object(
  {
    packId: Type.String({ minLength: 1 }),
    packName: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
    manifestSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    manifestAssetSha256: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
    atlasTextureUrl: Type.Optional(Type.String({ minLength: 1 })),
    atlasSpritesheetUrl: Type.Optional(Type.String({ minLength: 1 })),
    propAtlases: Type.Array(
      Type.Object(
        {
          textureUrl: Type.String({ minLength: 1 }),
          spritesheetUrl: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    provenanceSource: Type.String({ minLength: 1 }),
    releaseId: Type.Optional(Type.String({ minLength: 1 })),
    releaseSource: Type.Optional(Type.String({ minLength: 1 })),
    packLockSource: Type.Optional(Type.String({ minLength: 1 })),
    lockedAssetCount: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

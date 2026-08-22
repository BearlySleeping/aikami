// packages/shared/types/src/lib/backend/firestorage.ts
//
// R2 object metadata (Cloudflare R2 replaces Firebase Storage, C-426).

export type R2ImageMetadata = {
  contentType: string;
  customMetadata?: {
    creatorUID?: string;
    teamId?: string;
  };
};

export type FirestorageImageMetadata = {
  contentType: string;
  metadata: { firebaseStorageDownloadTokens: string };
  customMetadata?: {
    creatorUID?: string;
    teamId?: string;
  };
};

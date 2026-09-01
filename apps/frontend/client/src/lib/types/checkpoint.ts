// apps/frontend/client/src/lib/types/checkpoint.ts

/** Descriptor for a checkpoint/model returned by the image engine's model listing. */
export type CheckpointInfo = {
  readonly id: string;
  readonly description: string;
};

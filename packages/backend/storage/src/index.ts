// packages/backend/storage/src/index.ts

export {
  createWorkerObjectStore,
  createS3ObjectStore,
} from './lib/object_store.ts';
export type {
  ObjectStore,
  PutOptions,
} from './lib/object_store.ts';

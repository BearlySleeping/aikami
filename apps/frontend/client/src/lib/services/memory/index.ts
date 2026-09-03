// apps/frontend/client/src/lib/services/memory/index.ts
//
// Barrel export for the memory/lore retrieval service.
//
// Contract: C-458 In-House Memory & Lore Retrieval System

export { LocalEmbeddingBackend } from './local_embedding_backend';
export {
  MemoryRetrievalService,
  type MemoryRetrievalServiceInterface,
  type MemoryRetrievalServiceOptions,
  memoryRetrievalService,
} from './memory_retrieval_service.svelte';

// scripts/src/lib/ai/index.ts
// Barrel exports for shared AI utilities.
//
// Modules:
//   image_optimizer  — Lanczos resize, PNG8 quantisation, base64 codec
//   ai_vlm_client    — Multi-provider VLM: evaluate + describe images
//   ai_text_client   — Text LLM: SSE streaming + structured extraction

export * from './ai_text_client';
export * from './ai_vlm_client';
export * from './image_optimizer';

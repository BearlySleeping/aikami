// packages/shared/local-ai/src/index.ts
//
// Public entry point of @aikami/local-ai — the portable planning core for
// the local AI engine stack (C-391).
//
// 🔴 AC-0 boundary: this entry point (and everything it re-exports) must
// NOT import Node/Bun-only modules (node:child_process, node:fs, node:os)
// and must NOT depend on @aikami/local-stack or any app. Hosts (Bun CLI,
// Tauri) implement ProbeExecutor and supply their own adapters.

// Re-export the shared types the core consumes so a consumer can build with
// only @aikami/local-ai, @aikami/types, and @aikami/schemas (AC-0).
export type {
  CudaMajor,
  GpuVendor,
  HardwareProfile,
  ManifestEntryModality,
  ManifestEntryTier,
  ModelManifest,
  ModelManifestEntry,
  StackBackend,
  StackModality,
  StackPlan,
  StackPlanModel,
} from '@aikami/types';
export * from './lib/artifact_resolver.ts';
export * from './lib/asset_generation.ts';
export * from './lib/asset_staging_fragments.ts';
export * from './lib/audio/index.ts';
export * from './lib/detect.ts';
export * from './lib/engines/index.ts';
export * from './lib/fixture_executor.ts';
export * from './lib/generated_asset.ts';
export * from './lib/generation_audit.ts';
export * from './lib/generation_job_state.ts';
export * from './lib/generation_plan.ts';
export * from './lib/generation_provenance.ts';
export * from './lib/generation_spec.ts';
export * from './lib/host_detect.ts';
export * from './lib/hosted_generation.ts';
export * from './lib/manifest.ts';
export * from './lib/preparation/atlas_bounds.ts';
export * from './lib/preparation/preparation_profile_registry.ts';
export * from './lib/preparation/preparation_qa.ts';
export * from './lib/preparation/prepare_image.ts';
export * from './lib/preparation/rgba_image.ts';
export * from './lib/preparation/sprite_sheet_qa.ts';
export * from './lib/probe_executor.ts';
export * from './lib/recipes/recipe_registry.ts';
export * from './lib/recommend.ts';
export * from './lib/redirect_validator.ts';
export * from './lib/tier_table.ts';
export * from './lib/workflows/workflow_compiler.ts';
export * from './lib/workflows/workflow_profile_registry.ts';

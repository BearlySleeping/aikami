// packages/frontend/preview/src/sandbox.ts
//
// Engine-mounting preview — WalkSandbox pulls in GameWorld, bitecs, and the worker.
// Separated from the static previews so hosts that only need static previews
// never pull the engine bundle.

export { default as WalkSandbox } from './lib/sandbox/walk_sandbox.svelte';
export {
  getWalkSandboxViewModel,
  type WalkSandboxViewModelInterface,
} from './lib/sandbox/walk_sandbox_view_model.svelte';

// packages/frontend/engine/src/index.ts
// ---------------------------------------------------------------------------
// Public game engine exports — union of sim + render + content subpaths
// ---------------------------------------------------------------------------
//
// Subpath entrypoints:
//   @aikami/frontend/engine/sim      — pure ECS, math, GOAP (no PixiJS)
//   @aikami/frontend/engine/content   — assets, entities, LPC (no PixiJS)
//   @aikami/frontend/engine/render    — PixiJS rendering, GPU
//   @aikami/frontend/engine/node      — filesystem I/O, Turso hydration
//   @aikami/frontend/engine/worker    — Web Worker entrypoint
//
// GameWorld and EngineBridge are orchestration — they import from all sides
// and are exported only from the root barrel.

export * from './content.ts';
// EngineBridge (OOP contract — the sole UI↔Game boundary)
export type { EngineBridge } from './engine_bridge.ts';
export { createEngineBridge, MockEngineBridge } from './engine_bridge.ts';
// GameWorld (lifecycle manager)
export type { GameWorldInitializeOptions, GameWorldOptions, PlayerInitData } from './game_world.ts';
export { GameWorld } from './game_world.ts';
export * from './render.ts';
export * from './sim.ts';

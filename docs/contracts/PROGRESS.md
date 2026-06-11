# Contract Implementation Progress

## Status Summary (Audit: 2026-06-08)

| Contract | Name | Status |
|----------|------|--------|
| C-001 | Remove AI Vendor Directories | ✅ completed |
| C-002 | Establish Knowledge Directory | ✅ completed |
| C-003 | Establish .pi Setup | ✅ completed |
| C-004 | Migrate Skills to .pi/skills | ✅ completed |
| C-005 | Restructure Packages Under packages/shared/ | ✅ completed |
| C-006 | Add packages/frontend/configs | ✅ completed |
| C-007 | Establish Scripts Project | ✅ completed |
| C-008 | Copy .moon Setup | ✅ completed |
| C-009 | Standardize Configs | ✅ completed |
| C-010 | Setup Script | ✅ completed |
| C-011 | Blackbox Testing Infrastructure | ✅ completed |
| C-012 | Generate llms.txt & CONTEXT.md | ✅ completed |
| C-013 | (no contract file) | — |
| C-014 | Database Abstraction & Data Connect | ✅ completed |
| C-015–C-016 | (no contract files) | — |
| C-017 | Update Knowledge Base | ✅ completed |
| C-018–C-024 | (no contract files) | — |
| C-025 | TTS Audio Streaming & Synchronization | ✅ completed |
| C-026–C-028 | (no contract files) | — |
| C-029 | Menu Auth Wiring & Vanilla PixiJS Character Creation | ✅ completed |
| C-101 | Shared Package Enforce (Boundary Bleed) | ✅ completed |
| C-102 | Tauri SPA Enforcement | ✅ completed |
| C-030 | (no contract file) | — |
| C-031 | SvelteKit Adapter Static & Firebase Hosting | ⏳ not_started |
| C-032 | LPC Spritesheet Shader & Pipeline Integration | ⏳ not_started |
| C-033 | LPC Multi-Layer UBO Batching & Reactive Buffer Pipeline | ⏳ not_started |
| C-034 | LPC Render Pipeline | ✅ completed |
| C-035-ecs | Combat Engine ECS-Svelte Sync | ✅ completed |
| C-035-viewport | Viewport Layer Integration | ✅ completed |
| C-036 | ECS Appearance Bridge | ✅ completed |
| C-037 | LPC Render Demo | ✅ completed |
| C-038 | LPC Spritesheet Texture Arrays | ✅ completed |
| C-039 | LPC Animation Controller | ✅ completed |
| C-040 | Grid Movement Transform Pipeline | ✅ completed |
| C-041 | World Economy Inventory Core | ✅ completed |
| C-042 | Reusable LPC Sprite Component | ✅ completed |
| C-043 | LPC Layer Visual Debugger | ✅ completed |
| C-044 | LPC Fallback Grid Projection | ✅ completed |
| C-045 | Pixi Graphics Dirty Flag Synchronizer | ⏳ not_started |
| C-046 | Nix Chromium Extension Injection | ✅ completed |
| C-047 | Pixi DevTools Emulator Wiring | ✅ completed |
| C-048 | LPC Laboratory and Texture Projection | ✅ completed |
| C-049 | LPC Asset Injector and Visual Workbench | ✅ completed |
| C-050 | LPC Visual Testing Harness | ✅ completed |
| C-051 | LPC Rendering Fixes | ✅ completed |
| C-052 | Unified Blackbox & Docker Runner | ✅ completed |
| C-054 | Shared E2E Pattern Refactor | ✅ completed |
| C-055 | Secure E2E Baseline & Fix UI Assertions | ✅ completed |
| C-056 | Hybrid Text Generation Gateway | ✅ completed |
| C-057 | Edge-Native TTS Worker | ✅ completed |
| C-058 | ComfyUI Orchestration | ✅ completed |
| C-059 | Client-Side Stream Sync | ✅ completed |
| C-060 | Dialogue System Integration | ✅ completed |
| C-061 | Frontend App Consolidation | ✅ completed |
| C-062 | Dialogue Context & Memory Manager | ✅ completed |
| C-063 | Hybrid Expression Extraction & Caching | ✅ completed |
| C-064 | Dev Console & View-Model Layout Integration | ✅ completed |
| C-065 | Dev UI Tailwind Refactor & Text Sandbox | ✅ completed |
| C-066 | Dev UI Voice & Image Sandboxes | ✅ completed |
| C-067 | Voice Microservice & Tmux Orchestration | ✅ completed |
| C-068 | Voice Microservice Containerization | ✅ completed |
| C-069 | Direct Kokoro Orchestration | ✅ completed |
| C-070 | Image Microservice & Tmux Orchestration | ✅ completed |
| C-071 | Text Microservice & Tmux Orchestration | ✅ completed |
| C-072 | Frontend Text Sandbox & E2E Validation | ✅ completed |
| C-073 | LPC Visual Smoke Harness & AI Evaluation Pipeline | ✅ completed |
| C-074 | LPC Screenshot Isolation & Element Bounding Box Target | ✅ completed |
| C-075 | LPC Macro Clipping Bounds and Pixel Target Centering | ✅ completed |
| C-076 | Dev UI Image Sandbox Checkpoint Selection | ✅ completed |
| C-077 | Dev UI Text Sandbox Refactor & OpenRouter Toggle | ✅ completed |
| C-078 | Dev Character Creation Sandbox | ✅ completed |
| C-079 | Ultimate Configuration Dashboard | ✅ completed |
| C-080 | Unified Text & Structural Intelligence Service | ✅ completed |
| C-081 | Character Creation Structural Extraction Pipeline | ✅ completed |
| C-100 | MVVM Sandbox Pattern (Character Dev) | ✅ completed |
| C-104 | Sandbox Infrastructure (Dev Tools) | ✅ completed |
| C-105 | Chat System MVVM & Sandbox | ✅ completed |
| C-106 | Combat System MVVM & Dev Sandbox | ✅ completed |
| C-107 | Inventory System MVVM & Dev Sandbox | ✅ completed |
| C-108 | Quest System MVVM & Dev Sandbox | ✅ completed |
| C-109 | Service Layer Restructure & Client Flattening | ✅ completed |
| C-110 | Sandbox E2E Testing | ✅ completed |
| C-111 | Microservice Rewiring | ✅ completed |
| C-112 | Client Rename & Build Fixes | ✅ completed |
| C-113 | Tauri Desktop Sanity Check | ✅ completed |
| MIG-001 | Knowledge Splitting (.context/ + docs/) | ✅ completed |
| MIG-002 | Backend DataConnect Restructure | ⏳ not_started |
| MIG-003 | Scripting Infrastructure Reorganization | ✅ completed |
| MIG-004 | Frontend Configs Alignment | ✅ completed |
| C-114 | Sandbox Engine Wiring | ✅ completed |

### C-114: Sandbox Engine Wiring

**Files modified**:
- `packages/frontend/engine/src/worker/ecs_worker.ts` — Added missing `ENTITY_CREATED` for test sprite; guarded `SharedArrayBuffer` instanceof; added `self.onerror`/`self.onunhandledrejection` handlers; wrapped `onmessage` in try/catch; added startup sentinel log
- `packages/frontend/engine/src/game_world.ts` — Guarded `SharedArrayBuffer` instanceof; improved worker error reporting (filename, line, col); made `workerFactory` injectable via constructor options object; added worker URL logging
- `apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view_model.svelte.ts` — EngineBridge + GameWorld lifecycle with Vite `?worker` import; try/catch with `engineError` `$state`; NPC spawn on GAME_READY
- `apps/frontend/client/src/lib/views/dev/sandbox/sandbox_view.svelte` — Removed raw PixiJS boilerplate; canvas handoff; status/error overlays
- `apps/frontend/client/src/lib/views/dev/sandbox/ecs_worker.d.ts` — Type declaration for Vite `?worker&type=module` import
- `apps/frontend/client/src/env.d.ts` — (no changes retained)

**Deviations**:
1. Switched worker creation from `new URL(..., import.meta.url)` to Vite `?worker&type=module` import because Vite doesn't resolve `new Worker(new URL(...))` correctly across workspace package boundaries in dev mode
2. `GameWorld` constructor changed from positional `(bridge, apiService?, aiService?)` to options object `(bridge, options?)` to accept `workerFactory`

**Deviations**: None.

**Known limitations**: The bouncing test sprite (eid 2) has no NPCDialog component, so interaction only works with the explicitly spawned Guide NPC. The view's `onMount` for canvas handoff is minimal (1-line delegation) and conforms to the spirit of the ViewModel pattern.

---

> *For granular execution logs of completed contracts, see [PROGRESS_ARCHIVE.md](./PROGRESS_ARCHIVE.md)*

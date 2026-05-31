# @app/game

Standalone PixiJS + bitECS game with vanilla TypeScript frontend.

## Overview

This is a standalone game application for Aikami built with PixiJS v8 and bitECS. It provides:
- 2D game world with menu-driven launch
- NPC interactions and AI-driven dialogue
- Entity Component System (ECS) architecture
- Communication with Firebase backend via game API
- No SvelteKit dependency — runs as a standalone Vite app

## Tech Stack

- **Rendering**: PixiJS v8 (WebGPU/WebGL)
- **ECS**: bitECS (entity-component-system pattern)
- **Language**: Vanilla TypeScript
- **Testing**: Playwright + bun test
- **Build**: Vite

## Installation

This is a workspace app managed by moon. Install dependencies:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `dev` | `bun run dev` | Start Vite dev server |
| `build` | `bun run build` | Build for production |
| `preview` | `bun run preview` | Preview production build |
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |
| `lint` | `biome lint .` | Lint code with Biome |
| `format` | `biome format .` | Format code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun run test` | Run full test suite (unit + E2E) |
| `test-unit` | `bun run test:unit` | Run unit tests only |
| `test-e2e` | `bun run test:e2e` | Run Playwright E2E tests |

## Project Structure

```
src/
├── engine/            # Game engine (PixiJS + bitECS)
│   ├── components/    # ECS component definitions
│   ├── entities/      # ECS entity factories
│   ├── services/      # Engine services (api, ai, config)
│   ├── systems/       # ECS system pipelines
│   ├── engine_bridge.ts  # OOP bridge between UI ↔ Game engine
│   ├── game_world.ts  # Lifecycle manager for the game world
│   ├── pixi_app.ts    # PixiJS Application setup
│   └── types.ts       # Engine event/command types
├── menu/              # Menu controller (resolution, start)
├── main.ts            # Application entry point
└── index.html         # HTML shell with canvas
```

## Architecture

```
User Input → MenuController → GameWorld
                                  ├── EngineBridge (IPC-like boundary)
                                  ├── PixiApp (rendering)
                                  ├── Systems (ECS tick pipeline)
                                  └── Services (API, AI, config)
```

The **EngineBridge** is the sole communication boundary between the UI (menu) and the game engine. All commands and events pass through typed interfaces.

## Dependencies

This app depends on:
- `@aikami/frontend-api-core` — Game API client and AI providers

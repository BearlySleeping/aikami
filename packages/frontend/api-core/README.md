# @aikami/frontend-api-core

Game engine API client and frontend AI provider abstraction layer.

## Use Case

This package provides the frontend-facing API and AI client layer used by the PixiJS game and PWA:
- Game API client for communicating with Firebase backend
- Frontend AI client abstraction (OpenAI, Gemini, Ollama, ComfyUI)
- Mock AI client for offline development
- Plugin-based factory for dynamic client selection

## Where It's Used

Used by `apps/frontend/game` (PixiJS engine services) and potentially by PWA view models that need AI access.

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` — Constant values
- `@aikami/schemas` — Zod schemas for validation
- `@aikami/types` — Type definitions
- `@aikami/logger` — Logging utilities
- `@aikami/utils` — Shared utilities

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { createAiClient, GameApiClient } from '@aikami/frontend/api-core';

// Create an AI client (auto-selected by config)
const ai = createAiClient({ provider: 'openai' });
const reply = await ai.generate('Hello!');

// Communicate with backend
const api = new GameApiClient(/* ... */);
await api.sendAction({ type: 'move', direction: 'north' });
```

## Architecture

- **Game API** — Client for backend game endpoints (actions, state, NPCs)
- **AI Interface** — Abstract frontend AI client contract
- **Cloud Providers** — OpenAI, Gemini (server-reachable)
- **Local Providers** — Ollama, ComfyUI, LocalTTS (local/sidecar processes)
- **Mock** — Deterministic mock for tests and offline development
- **Factory** — Config-driven provider selection

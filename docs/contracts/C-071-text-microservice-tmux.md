## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami reference: `knowledge/contracts/TEMPLATE.md` |
| **Target** | `apps/backend/text` — Text Microservice & Tmux Orchestration |
| **Priority** | P1 — Mirror image microservice infrastructure for local LLM text generation |
| **Dependencies** | C-070 |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

We are scaffolding `apps/backend/text` as a standalone microservice using the official `ollama/ollama` Docker image. This mirrors the pattern established in C-070 for the image service. We will allocate development ports, integrate the service into our shared tmux orchestrator, and provide local caching volumes for downloaded LLM weights.

## Design Reference

**Aikami pattern**: `apps/backend/image`
Key structural elements:
- Container-only Moon project (no Bun source code, just orchestration scripts).
- `dev:docker` script in `package.json` handling cleanup and container execution (using `podman run` or `docker run` to match existing patterns).
- Tmux orchestrator integration in `scripts/src/lib/tmux/`.
- Dedicated port allocations in `packages/shared/constants/src/lib/development_ports.ts`.

## Changes Detail

1. Create `apps/backend/text` with a `Dockerfile`, `package.json`, `moon.yml`, and `tsconfig.json`.
2. Configure `package.json` with a `dev:docker` script that binds port 11434 and mounts a local volume (e.g., `./src/cache/ollama:/root/.ollama`) for model persistence.
3. Update `packages/shared/constants/src/lib/development_ports.ts` to include `text` (Emulator: 11434, Staging: 11433, Production: 11435).
4. Update `scripts/src/lib/tmux/` scripts (`session.ts`, `cli.ts`, `ALL_SERVICES`, etc.) to register the `text` service.
5. Create an API verification script `scripts/check_health.ts` that pings Ollama's base URL (`http://localhost:11434/`) expecting a 200 OK ("Ollama is running").
6. Register the new project in `.moon/workspace.yml`.

## Acceptance Criteria

### AC-1: Ports & Config Refactor
**Given** the shared constants package
**When** the development ports are queried
**Then** `text` exists in `EMULATOR_PORTS` (11434), `STAGING_PORTS` (11433), and `PRODUCTION_PORTS` (11435).

**Test Hooks**:
- Unit: Downstream typechecks must pass cleanly.

### AC-2: Tmux Scripts Refactored
**Given** the tmux orchestrator CLI
**When** a developer runs `bun tmux:start text`
**Then** a new tmux window is created running `bun run dev` in `apps/backend/text`.

**Test Hooks**:
- Integration: `text` is recognized as a valid `DevService` union member and appears in CLI help text.

### AC-3: Text Microservice Containerization
**Given** the new `apps/backend/text` project
**When** `bun run dev` is executed
**Then** the Ollama container boots up, binds to port 11434, and persists data to `src/cache/ollama`.

**Test Hooks**:
- Unit: `Dockerfile` uses `FROM ollama/ollama`. `moon.yml` is correctly tagged and categorized.

### AC-4: API Verification Script
**Given** the Ollama container is running
**When** `bun run test:text` (which invokes `scripts/check_health.ts`) is executed
**Then** it successfully fetches `/` and reports readiness, gracefully handling `ECONNREFUSED` if offline.

## Implementation Notes

1. **Files to create**:
    - `apps/backend/text/Dockerfile`
    - `apps/backend/text/package.json`
    - `apps/backend/text/moon.yml`
    - `apps/backend/text/tsconfig.json`
    - `apps/backend/text/scripts/check_health.ts`
    - `apps/backend/text/README.md`
2. **Files to modify**:
    - `packages/shared/constants/src/lib/development_ports.ts`
    - `scripts/src/lib/tmux/session.ts`
    - `scripts/src/lib/tmux/cli.ts`
    - `.moon/workspace.yml`
3. **Order of operations**: Port constants -> Tmux orchestrator -> Scaffold text project -> Health script -> Workspace registration.
4. **Verification**: Run `bun tmux:start text`, wait for boot, then run `bun run test:text` inside the package. Ensure `moon run text:typecheck` and global `validate()` pass.

## Edge Cases & Gotchas

- **Container Engine Parity**: Ensure the `dev:docker` script syntax in `package.json` uses `podman run` (like the image service) or `docker run` depending on local environment preferences, but ensure `docker rm -f` is used to clean up old instances to prevent port collisions.
- **Volume Permissions**: Ollama runs as root internally by default; mapping `./src/cache/ollama` might create root-owned files on the host. This is acceptable for local dev but worth noting if manual deletion is required later.

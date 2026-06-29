<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Roadmap Phase 3: Stability, Memory, & Packaging |
| **Target** | `src-tauri/` and root configuration files |
| **Priority** | P1 — Final step to achieve a playable MVP executable |
| **Dependencies** | C-155 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

This contract marks the culmination of the MVP. We will configure and build the final Tauri desktop executable (`.exe` / `.app` / `.dmg`). The focus is on finalizing `tauri.conf.json`, ensuring the production build pipeline successfully compiles the SvelteKit frontend and Rust backend, and verifying that our Service Worker/client interceptors and local Ollama pings function correctly inside the Tauri WebView environment.

## Design Reference

Refer to the official Tauri v2 documentation for integrating SvelteKit (static adapter) and handling localhost HTTP requests within the WebView security boundaries.

## Architecture Directives

- **SvelteKit Adapter:** Ensure `@sveltejs/adapter-static` is configured correctly for Tauri, as the Tauri WebView requires static files.
- **Tauri Configuration:** Finalize `tauri.conf.json`. 
- **Security & Permissions:** Configure Tauri's capabilities/permissions to explicitly allow HTTP requests to `localhost:11434` (Ollama default port) to ensure the AI integration is not blocked by CORS or WebView strictness in production.
- **Asset Bundling:** Ensure all PixiJS assets, audio files, and WebGPU/Kokoro models are correctly included in the final build bundle and pathing resolves correctly in production (avoiding `undefined` dev-server paths).

## State & Data Models

- No new game state models. This is purely an infrastructure and DevOps contract.

## Acceptance Criteria

### AC-1: Production Build Success
**Given** the complete MVP codebase
**When** the developer runs the Tauri build command (`npm run tauri build` or equivalent)
**Then** the project compiles successfully without SvelteKit routing errors or Rust compilation panics, outputting a valid OS-specific executable.

### AC-2: Local LLM Connectivity
**Given** the compiled Tauri application is running
**When** the player interacts with a Vendor or engages in Combat
**Then** the application successfully communicates with the local Ollama instance on port 11434 without CORS or permission blocks.

### AC-3: Asset Resolution
**Given** the compiled Tauri application is running
**When** the player loads a map
**Then** all textures, audio files, and UI elements load correctly without 404 errors related to static pathing.

### AC-4: Post-Mortem Documentation
**Given** the contract is ready to be committed and pushed
**When** updating the progress logs
**Then** `docs/contracts/PROGRESS.md` must be updated with a "Developer Notes — Quirks, Gotchas & Post-Mortem" section detailing any WebView limitations, CORS hurdles, pathing issues, or known constraints discovered during the build process.

**Test Hooks**:
- Manual: Run the compiled executable, create a character, fight a monster, buy an item, and transition to a new map. Check the developer console (if enabled) for silent failures.

**Watch Points**:
- **Service Workers in Tauri:** Tauri uses custom protocols (like `tauri://` or `asset://`). Service Workers can sometimes behave unpredictably or fail to register on these custom protocols compared to `http://localhost`. Verify the interceptors still work.
- **Pathing:** Double-check relative vs. absolute paths for PixiJS assets. `adapter-static` handles base paths differently than a dynamic dev server.

## Implementation Notes

1. **Files to modify**:
    - `src-tauri/tauri.conf.json`
    - `src-tauri/capabilities/default.json` (or equivalent v2 permissions config)
    - `apps/frontend/client/svelte.config.js` (verify adapter-static settings)
    - `docs/contracts/PROGRESS.md`
2. **Order of operations**:
    - Verify SvelteKit static adapter configuration.
    - Update Tauri configs for permissions and window sizing.
    - Run a production build and perform a manual QA pass.
    - Document findings and gotchas in `PROGRESS.md`.

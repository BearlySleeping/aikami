## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory: Tauri v2 migration, PixiJS v8 + bitECS game engine, pi MCP/skills for AI context |
| **Target** | `apps/frontend/client/` — Tauri initialization; `.pi/mcp.json` + `.pi/skills/` — AI tooling context |
| **Priority** | P1 — Foundation for desktop exports and game engine integration; enables AI-assisted Tauri/PixiJS development |
| **Dependencies** | C-012 (knowledge docs must be current before adding new skills) |
| **Status** | **—** |
| **Contract version** | 1.0.0 |

## Overview

Initialize Tauri v2 within the existing SvelteKit PWA app to enable cross-platform desktop exports. Install PixiJS v8 and bitECS as the core game engine stack. Provide the AI coding agent (pi) with strict contextual knowledge for Tauri and PixiJS via MCP server configuration and/or dedicated `.pi/skills/`, so it can assist with development without hallucinating API details. Update the monorepo moon task configuration to support Tauri dev and build workflows alongside existing Vite-based tasks.

## Design Reference

**Architecture principle**: Abstraction & Wrappers First — Tauri and PixiJS are concrete implementations. The existing `packages/frontend/services/` should eventually abstract desktop (Tauri) vs. web (browser) platform differences, but this contract only establishes the tooling foundation.

**Tauri v2 + SvelteKit pattern**:
- Tauri v2 uses `@tauri-apps/cli` for project scaffolding and build
- `src-tauri/` directory at the app root (not inside PWA's src/)
- `tauri.conf.json` defines window, bundle, and allowlist configuration
- `@tauri-apps/api` provides the JS bridge for desktop features
- SvelteKit adapter-static or adapter-node for Tauri's embedded webview

**PixiJS v8 + bitECS pattern**:
- PixiJS v8 is the rendering engine (WebGL/WebGPU)
- bitECS is a lightweight ECS (Entity Component System) for game logic
- Both are runtime dependencies, not build-time tooling
- Should be installed in the PWA (or gamejs) project, not as shared packages initially

## Changes Detail

### 1. Tauri v2 Initialization in PWA

Add Tauri v2 scaffolding to `apps/frontend/client/`:
- `src-tauri/` directory with `Cargo.toml`, `src/main.rs`, `tauri.conf.json`, `capabilities/`, `icons/`
- `@tauri-apps/cli` as devDependency, `@tauri-apps/api` as dependency in PWA `package.json`
- New `package.json` scripts: `"tauri": "tauri"`, `"tauri:dev": "tauri dev"`, `"tauri:build": "tauri build"`
- Tauri configuration:
  - Window title: "Aikami"
  - Dev URL: `http://localhost:5173` (Vite dev server)
  - Build: SvelteKit static adapter output pointing to `build/` dir
  - Bundle identifier: `com.aikami.app`

### 2. PixiJS v8 + bitECS Installation

Add game engine dependencies to PWA:
- `pixi.js` (v8.x) as dependency
- `bitecs` as dependency
- No game code yet — this contract only installs the packages

### 3. AI Tooling Context (MCP + Skills)

Provide pi with PixiJS v8 and Tauri v2 reference knowledge via one of:
- **Option A**: MCP servers using `@anthropic/context7`-style documentation indexing for PixiJS and Tauri docs
- **Option B**: Local `.pi/skills/` with curated SKILL.md files containing API overviews, common patterns, and gotchas

The contract should evaluate both and implement the most reliable approach. Skills are simpler and offline-capable; MCP servers provide live doc lookup. Given that Tauri and PixiJS APIs are stable (v2 and v8 respectively), skills are preferred as the primary mechanism with MCP as a fallback enhancement.

### 4. Moon Task Configuration

Update `apps/frontend/client/moon.yml`:
- Add `tauri:dev` task: `command: 'bun'`, `args: ['run', 'tauri:dev']`, `preset: 'server'`
- Add `tauri:build` task: `command: 'bun'`, `args: ['run', 'tauri:build']`, with appropriate inputs/outputs
- Add `src-tauri/**/*` to fileGroups for Rust source tracking
- Ensure Tauri tasks don't conflict with existing `dev`/`build` Vite tasks

## Acceptance Criteria

### AC-1: Tauri v2 Scaffolding Created
**Given** the PWA is a SvelteKit app at `apps/frontend/client/`
**When** Tauri v2 is initialized
**Then** `apps/frontend/client/src-tauri/` exists with `Cargo.toml`, `src/main.rs`, `tauri.conf.json`, and `capabilities/default.json`

**Test Hooks**:
- Unit: `test -f apps/frontend/client/src-tauri/Cargo.toml`
- Unit: `test -f apps/frontend/client/src-tauri/tauri.conf.json`
- Unit: `test -f apps/frontend/client/src-tauri/src/main.rs`

**Watch Points**:
- `src-tauri/` must NOT be inside `apps/frontend/client/src/` — it belongs at the app root level
- `tauri.conf.json` must reference the correct dev URL (Vite port 5173)

### AC-2: Tauri Package Scripts Added
**Given** the PWA `package.json`
**When** Tauri CLI is installed
**Then** `package.json` has `"tauri:dev"` and `"tauri:build"` scripts, and `@tauri-apps/cli` and `@tauri-apps/api` are in devDependencies/dependencies

**Test Hooks**:
- Unit: `bun run tauri:dev --help` exits successfully (Tauri CLI responds)
- Unit: `grep '"tauri:dev"' apps/frontend/client/package.json`
- Unit: `grep '@tauri-apps/cli' apps/frontend/client/package.json`

**Watch Points**:
- `@tauri-apps/cli` must be devDependency (build-time), `@tauri-apps/api` must be dependency (runtime)
- Verify `bun install` resolves Tauri packages without errors

### AC-3: PixiJS v8 and bitECS Installed
**Given** the PWA project
**When** game engine dependencies are added
**Then** `pixi.js` (v8.x) and `bitecs` are in `package.json` dependencies and `node_modules/` contains them

**Test Hooks**:
- Unit: `grep '"pixi.js"' apps/frontend/client/package.json` shows v8 major version
- Unit: `grep '"bitecs"' apps/frontend/client/package.json`
- Unit: `test -d apps/frontend/client/node_modules/pixi.js`
- Unit: `test -d apps/frontend/client/node_modules/bitecs`

**Watch Points**:
- PixiJS v8 uses `pixi.js` (not `@pixi/...` scoped packages for the main entry)
- bitECS package name is `bitecs` (not `bitecs` or `@bitecs/...`)

### AC-4: AI Tooling Skills Created
**Given** pi needs contextual knowledge for Tauri v2 and PixiJS v8
**When** skills are configured
**Then** `.pi/skills/tauri-v2/SKILL.md` and `.pi/skills/pixijs-v8/SKILL.md` exist with API reference, patterns, and gotchas

**Test Hooks**:
- Unit: `test -f .pi/skills/tauri-v2/SKILL.md`
- Unit: `test -f .pi/skills/pixijs-v8/SKILL.md`
- Unit: `tauri-v2/SKILL.md` contains sections on `@tauri-apps/api` modules, window management, and IPC (invoke)
- Unit: `pixijs-v8/SKILL.md` contains sections on Application, Container, Graphics, and Asset loading

**Watch Points**:
- Skills must NOT duplicate full API docs — they should be curated cheat sheets (~200-400 lines each)
- Include commonly used APIs only: Tauri (invoke, window, fs, dialog, shell), PixiJS (Application, Container, Sprite, Graphics, Text, Assets)
- Include a "Gotchas" section with known pitfalls (e.g., Tauri's CSP restrictions, PixiJS async texture loading)

### AC-5: Moon Tasks for Tauri
**Given** the PWA moon.yml
**When** Tauri tasks are added
**Then** `moon run client:tauri-dev` starts Tauri dev mode and `moon run client:tauri-build` produces a desktop binary

**Test Hooks**:
- Unit: `grep 'tauri-dev' apps/frontend/client/moon.yml`
- Unit: `grep 'tauri-build' apps/frontend/client/moon.yml`
- Integration: `moon run client:tauri-dev` starts without errors (does not need to fully launch window — CLI start is sufficient)
- Integration: `moon run client:tauri-build` compiles the Rust backend successfully

**Watch Points**:
- `tauri-dev` should be a persistent server task (preset: 'server')
- `tauri-build` should track `src-tauri/**/*` as inputs
- Tauri build output (`.deb`, `.AppImage`, `.dmg`, `.msi`) should be in `outputs`
- Ensure Tauri tasks don't interfere with existing Vite `dev`/`build` tasks — they are separate commands

## Implementation Notes

1. **Files to create**:
   - `apps/frontend/client/src-tauri/Cargo.toml` — Rust project manifest
   - `apps/frontend/client/src-tauri/src/main.rs` — Tauri entry point
   - `apps/frontend/client/src-tauri/tauri.conf.json` — Tauri configuration
   - `apps/frontend/client/src-tauri/capabilities/default.json` — Tauri v2 capability permissions
   - `apps/frontend/client/src-tauri/icons/` — app icons (placeholder or generated)
   - `.pi/skills/tauri-v2/SKILL.md` — Tauri v2 AI context skill
   - `.pi/skills/pixijs-v8/SKILL.md` — PixiJS v8 AI context skill

2. **Files to modify**:
   - `apps/frontend/client/package.json` — add Tauri, PixiJS, bitECS deps + scripts
   - `apps/frontend/client/moon.yml` — add tauri-dev, tauri-build tasks + fileGroups
   - `.pi/mcp.json` — optionally add Tauri/PixiJS doc MCP servers (if approach chosen)

3. **Files to delete**: None

4. **Order of operations**:
   1. Install PixiJS v8 + bitECS (pure JS deps, no toolchain needed)
   2. Create `.pi/skills/tauri-v2/SKILL.md` and `.pi/skills/pixijs-v8/SKILL.md`
   3. Initialize Tauri v2 scaffolding (`bunx @tauri-apps/cli init` or manual scaffold)
   4. Add Tauri scripts to `package.json`
   5. Update `moon.yml` with Tauri tasks
   6. Run `bun install` to resolve all new dependencies
   7. Verify `bun tauri dev` starts the dev window

5. **Verification**:
   - `bun run tauri:dev` opens Tauri window (manual verification)
   - `bun run tauri:build` compiles successfully
   - `moon run client:tauri-dev` works through moon orchestrator
   - AI can reference `.pi/skills/tauri-v2/SKILL.md` and `.pi/skills/pixijs-v8/SKILL.md` for accurate API guidance

## Edge Cases & Gotchas

- **Rust toolchain**: Tauri v2 requires Rust (rustc, cargo) installed. The setup script should detect this but the contract itself only scaffolds — the developer must have Rust installed
- **System dependencies**: Tauri on Linux requires `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, and other system packages. Document these in the skill file but do not block the contract
- **SvelteKit adapter**: Tauri with SvelteKit typically uses `@sveltejs/adapter-static` (not adapter-auto or adapter-node) for production builds since Tauri serves from local files
- **CSP in Tauri**: Tauri's webview has strict CSP; external API calls must be allowlisted in `tauri.conf.json` or use Tauri's HTTP plugin
- **bitECS vs bitecs**: The npm package is `bitecs` (lowercase) — do not install the wrong package
- **PixiJS v8 breaking changes**: v8 changed the `Application` constructor API and asset loading pattern significantly — the skill must reflect v8, not v7
- **Tauri v2 vs v1**: v2 uses `@tauri-apps/api` v2.x with different module paths; the skill must cover v2 APIs only
- **moon task isolation**: Tauri build spawns Rust compilation which may conflict with moon's caching — mark `tauri-build` with `cache: false` initially

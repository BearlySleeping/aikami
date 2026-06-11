# Contract: C-070 — Image Microservice & Tmux Orchestration

## Metadata
| Field | Value |
|-------|-------|
| Source | `packages/shared/constants/src/lib/development_ports.ts`, `scripts/src/lib/tmux/` |
| Target | `apps/backend/image/`, `scripts/src/lib/tmux/`, `packages/shared/constants/` |
| Priority | P1 |
| Dependencies | C-069, C-058 |
| Status | completed |
| Version | 1.0.0 |

## Overview
Stand up `apps/backend/image` as a standalone ComfyUI microservice using the `yanwk/comfyui-boot` Docker image. Integrate it into the shared `tmux` orchestrator so it can be managed alongside `client`, `voice`, and `emulators`. Allocate development ports for the image service and create a test script to verify API health.

## Design Reference
- `apps/backend/voice/` (Container setup, package.json `dev:docker` script, test script)
- `scripts/src/lib/tmux/session.ts` (Service definitions and aliases)

## Architecture Directives

- **Development Ports**: Add `image` to the port allocations. Standard ComfyUI uses 8188, so we will assign `8188` (emulator), `8187` (staging), and `8193` (production).
- **Tmux Orchestrator**: Update the `DevService` union, aliases, and definitions in `scripts/src/lib/tmux/session.ts` to include the `image` service.
- **Image Microservice**: Create `apps/backend/image/` with a `Dockerfile` relying on `yanwk/comfyui-boot`. Include a `dev:docker` script in `package.json` that sets up a local volume for model caching (e.g., `-v aikami-comfyui-models:/comfyui/models`).
- **Health Test Script**: Create `scripts/check_health.ts` (or `generate.ts`) in the image app to hit the `/system_stats` REST endpoint to verify the container is alive and listening.

## State & Data Models

    Port Allocations (packages/shared/constants/src/lib/development_ports.ts):
        EMULATOR_PORTS: { ..., image: 8188 }
        STAGING_PORTS: { ..., image: 8187 }
        PRODUCTION_PORTS: { ..., image: 8193 }

## Acceptance Criteria

**AC-1: Ports & Config Refactor**
- Given the `development_ports.ts` file,
- When checking exported port ranges,
- Then the `image` property exists on emulator (8188), staging (8187), and production (8193) port maps, and downstream typechecks pass.

**AC-2: Tmux Scripts Refactored**
- Given the tmux CLI commands,
- When running `bun tmux:start image`,
- Then a tmux window named `image` is created, running `bun run dev` in `apps/backend/image`.

**AC-3: Image Microservice Containerization**
- Given the `apps/backend/image` directory,
- When running `bun run dev:docker`,
- Then the `yanwk/comfyui-boot` container starts, binds to port 8188, and exposes the ComfyUI API.

**AC-4: API Verification Script**
- Given the running ComfyUI container,
- When executing `bun run test:image` (which triggers `scripts/check_health.ts`),
- Then the script successfully fetches `/system_stats`, parses the JSON, and outputs a success message indicating the container is ready.

## Implementation Notes

1.  **Ports**: Update `packages/shared/constants/src/lib/development_ports.ts`. Add `image` to `EMULATOR_PORTS`, `STAGING_PORTS`, and `PRODUCTION_PORTS`.
2.  **Tmux**: Modify `scripts/src/lib/tmux/session.ts` (and related files like `cli.ts` if needed).
    - Add `'image'` to `DevService` union.
    - Add to `SERVICE_DEFS`:
        `name: 'image'`, `command: 'bun run dev'`, `cwd: (root) => resolve(root, 'apps/backend/image')`, `readyPort: EMULATOR_PORTS.image`.
    - Add alias `'image': 'image'` to `normalizeService`.
    - Add to `ALL_SERVICES`.
3.  **App Setup**: Create `apps/backend/image/`.
    - Add `package.json` with scripts: `"dev": "bun run dev:docker"`, `"dev:docker": "docker rm -f aikami-image-dev 2>/dev/null; docker run --rm --name aikami-image-dev -p 8188:8188 --network bridge -v aikami-comfyui-models:/root/ComfyUI/models yanwk/comfyui-boot:latest"`, `"test:image": "bun run scripts/check_health.ts"`. (Note: yanwk/comfyui-boot exposes port 8188).
    - Add `moon.yml` to define the project (tags: `application`, `backend`).
    - Add `tsconfig.json` extending the backend config.
    - Create `Dockerfile` referencing `FROM yanwk/comfyui-boot:latest` and `EXPOSE 8188` (optional, for consistency with voice).
4.  **Test Script**: Write `apps/backend/image/scripts/check_health.ts`. Fetch `http://localhost:8188/system_stats`. If successful, print "✓ ComfyUI API is responsive". Handle ECONNREFUSED with a friendly message to run `bun tmux:start image`.
5.  **Workspace**: Add `image: "apps/backend/image"` to `.moon/workspace.yml`.

## Edge Cases & Gotchas
- The `yanwk/comfyui-boot` container structure places models in a specific directory. Ensure the volume mount in `dev:docker` maps to the correct internal models path (often `/runner/models` or `/root/ComfyUI/models` depending on the image internals, but mapping a root-level or known models dir ensures persistence).
- ComfyUI takes a moment to boot. The tmux readiness checker (`isPortReady`) expects an HTTP response. `/` might return a 200 (serving the HTML UI), which perfectly satisfies the port checker.

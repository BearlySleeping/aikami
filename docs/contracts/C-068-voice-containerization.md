# Contract: C-068 — Voice Microservice Containerization

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-067 |
| Status | not_started |
| Version | 1.0 |

## Overview
We need to containerize the `apps/backend/voice` microservice. Since it relies on the ONNX runtime for TTS processing, running it on bare metal will cause cross-platform dependency issues. We will create a multi-stage Bun Dockerfile mirroring our Nordclaw architecture and update the Moonrepo configuration so that local development spins the service up inside a Podman/Docker container automatically.

## Design Reference
- Review `apps/backend/audit-worker/Dockerfile` from the Nordclaw reference codebase for the standard `oven/bun:1` multi-stage build pattern.

## Architecture Directives
- **Voice Dockerfile**: A standard multi-stage build using `oven/bun:1`. It must install dependencies, copy the source, and expose the correct port (8089).
- **Moon Task Update**: Refactor the `dev` task in `apps/backend/voice/moon.yml` to build and run the container locally instead of executing `bun run main.ts` directly on the host. 
- **Graceful Termination**: Ensure the container runs with a name (e.g., `aikami-voice-dev`) and is explicitly cleaned up on stop, so `tmux:stop` successfully tears down the environment without leaving orphaned containers holding port 8089 hostage.

## State & Data Models
No new data models.

## Acceptance Criteria

- **AC1: Dockerfile Creation**
  - Given the `apps/backend/voice` package
  - When inspecting the directory
  - Then a valid multi-stage `Dockerfile` exists using `oven/bun:1` as the base image.
  - Test Hook: Run a local `docker build -t aikami-voice-test apps/backend/voice` and assert it compiles successfully.

- **AC2: Local Dev Container Orchestration**
  - Given the Moonrepo tasks for `voice`
  - When `moon run voice:dev` is executed
  - Then it executes a `podman run` (or `docker run`) command that mounts/builds the service and binds port 8089 to the host.
  - Test Hook: Execute the task and verify the container `aikami-voice-dev` is running and port 8089 is accessible.

- **AC3: Graceful Teardown**
  - Given an active `voice:dev` container task
  - When the process receives a termination signal (via Ctrl+C or tmux stop)
  - Then the container gracefully exits and cleans itself up (e.g., via `--rm`).
  - Test Hook: Terminate the moon task and verify `docker ps` no longer shows the container.

## Implementation Notes
1. Create `apps/backend/voice/Dockerfile`. Remember that Moonrepo operates from the workspace root context usually, so make sure your `COPY` statements correctly target the `apps/backend/voice` and any shared packages it relies on (`packages/backend/audio`, `packages/shared/constants`). Using a workspace-aware build context or a simple monorepo Docker build pattern is critical here.
2. If building a full monorepo Docker image is too slow for hot-reloading dev, you can update the `moon.yml` `dev` command to simply mount the local volume into an `oven/bun` container instead of building the Dockerfile every time:
   `command: docker run --rm --name aikami-voice-dev -p 8089:8089 -v .:/app -w /app/apps/backend/voice oven/bun:1 bun run --hot src/main.ts`
   *(Adjust volume paths as needed based on Moon's working directory).*
3. Add a `dockerfile` script inside `package.json` if needed to encapsulate the raw docker command so `moon.yml` can just call `bun run dev:docker`.

## Edge Cases & Gotchas
- **Monorepo Context**: The `voice` app depends on `@aikami/constants` and `@aikami/backend-audio`. A standard `Dockerfile` inside the app directory will fail if it cannot copy the `packages/` folder. The easiest fix for local dev is a volume mount `docker run` command running from the root, rather than a full `docker build` every save. For production, we'll build from the root context.
- **Podman vs Docker**: Default to `docker` commands in the scripts; developers using `podman` typically alias `docker=podman`.

# Metadata
| Field | Value |
| --- | --- |
| Source | shared |
| Target | apps/e2e, scripts |
| Priority | P0 |
| Dependencies | None |
| Status | not_started |
| Contract Version | 1.0.0 |

<!-- completed: 2026-06-06 -->

# Overview
This contract refactors the Aikami blackbox testing architecture to match the unified, deterministic pattern established in modern enterprise monorepos. It consolidates fragmented Playwright configurations from the PWA and Game directories into a standalone `apps/e2e` package. Crucially, it introduces a `DockerManager` into the testing orchestrator to support upcoming containerized AI microservices (Image, Voice, and Text generation) and ensures these containers can securely route traffic back to the host-bound Firebase Emulator suite.

# Design Reference
- The Nordclaw E2E unification strategy (`apps/e2e` consolidation).
- `scripts/src/lib/test_blackbox/run.ts` (Current Tmux orchestrator to be expanded).

# Architecture Directives
- **Unified E2E Workspace**: Create a dedicated `apps/e2e` package. Migrate all existing Playwright configurations, fixtures, and test suites from `apps/frontend/client` and `apps/frontend/game` into this central location. Define distinct Playwright projects for `client`, `game`, and the future `ai-services`.
- **Runtime Isolation**: Execute Playwright strictly under the Node.js runtime to prevent CDP websocket hanging errors, while continuing to utilize Bun for workspace orchestration.
- **Docker Orchestration Integration**: Develop `scripts/src/lib/test_blackbox/docker_manager.ts`. This class must mirror the interface of your existing `TmuxManager`, providing methods to build, start, poll (for readiness), and tear down Docker containers. Integrate this manager into `run.ts` so containerized backend services boot alongside the SvelteKit and Game dev servers.
- **Network Bridging**: Ensure the `DockerManager` automatically injects `host.docker.internal` (or the equivalent Linux gateway IP) into the environment variables of the spawned containers, allowing the containerized AI backends to seamlessly communicate with the local Firebase Auth and Firestore emulators running on the host.
- **Global Lifecycle Hooks**: Implement global setup and teardown scripts within `apps/e2e` that hit the Firebase Emulator REST APIs to completely purge Firestore and Auth data between major test suites, guaranteeing zero state bleed between game sessions.

# State & Data Models
The `DockerManager` will require a configuration map for future AI services:

    interface DockerServiceConfig {
        name: string;
        contextPath: string; // e.g., 'apps/backend/ai-image-gen'
        dockerfile: string;
        port: number;
        env: Record<string, string>;
        healthCheckPath: string;
    }

# Acceptance Criteria
### AC-1: E2E Package Consolidation
- Given the fragmented Playwright tests in the PWA and Game directories
- When the refactor is complete
- Then the `apps/e2e` package must serve as the sole entry point for all browser automation, containing a unified `playwright.config.ts` with distinct projects.
- Test Hook: Verify `moon run e2e:test` successfully executes without relying on app-specific configs.

### AC-2: DockerManager Implementation
- Given the blackbox testing script
- When the runner initializes
- Then it must instantiate the `DockerManager`, successfully build/pull a target image (even a dummy proxy for now), and confirm port readiness before launching Playwright.
- Test Hook: Assert the runner logs indicate the Docker container started and reached readiness, and that `docker ps` shows the container alive during the test window.

### AC-3: Emulator Network Bridging
- Given a test that requires a Dockerized backend to verify a user's token
- When the backend container attempts to contact the Firebase Auth emulator
- Then the request must successfully route out of the Docker bridge network to the host machine's emulator port.
- Test Hook: Verify the environment variables passed to the container map `FIREBASE_AUTH_EMULATOR_HOST` correctly to the Docker host gateway.

### AC-4: Deterministic Database Purging
- Given multiple parallel test suites
- When a test suite completes
- Then the global teardown hook must fire an HTTP DELETE request to the Firestore emulator, resetting the world state.
- Test Hook: Assert via REST that the Firestore document count drops to zero after the global teardown executes.

# Implementation Notes
1. Scaffold `apps/e2e` with its own `package.json` and `moon.yml`.
2. Move the `tests/` directories from `apps/frontend/client` and `apps/frontend/game` into `apps/e2e/tests/client` and `apps/e2e/tests/game`.
3. Create `docker_manager.ts` in `scripts/src/lib/test_blackbox/`. Use `bun:utils` or standard child processes to execute `docker build` and `docker run` commands dynamically.
4. Update `scripts/src/lib/test_blackbox/run.ts` to initialize the `DockerManager` alongside the `TmuxManager`.
5. Create `apps/e2e/src/global_setup.ts` and implement the Firebase REST API purge functions. Wire this into the `playwright.config.ts` globalSetup property.

# Edge Cases & Gotchas
- **Linux vs macOS Docker Networking**: `host.docker.internal` works natively on Docker Desktop for macOS and Windows. On native Linux, you may need to map the host gateway explicitly using `--add-host=host.docker.internal:host-gateway` in the `docker run` command constructed by your `DockerManager`.
- **Bun/Playwright Conflict**: Ensure the `package.json` in `apps/e2e` runs Playwright via standard Node (`npx playwright test`) rather than forcing `bunx`, to avoid the known CDP stalling issues.

# Contract: C-067 — Voice Microservice & Tmux Orchestration

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-066 |
| Status | not_started |
| Version | 1.0 |

## Overview
Our Text-to-Speech engine is built as a package but lacks a runtime host. Additionally, our `tmux` development orchestrator still references the deprecated `game` app. This contract covers standing up `apps/backend/voice` as a standalone Bun WebSocket server, updating the shared development ports, and refactoring the `scripts/src/lib/tmux` suite to manage the new `voice` service instead of `game`.

## Design Reference
- Review `scripts/src/lib/tmux/start.ts` and `session.ts` for the current orchestration logic.
- Review `packages/backend/audio/src/lib/tts_websocket_handler.ts` (built in C-057) to see how the Bun WebSocket handler is expected to be integrated.

## Architecture Directives
- **Development Ports Update**: Remove `game` and add `voice` (e.g., port `8081` or similar) in `packages/shared/constants/src/lib/development_ports.ts`.
- **Tmux Orchestrator Refactor**: Strip all references to `game` across the tmux script files (`start.ts`, `session.ts`, `stop.ts`, etc.). Add support for the `voice` service. Update the CLI help text.
- **Voice Microservice Host**: Create `apps/backend/voice` containing a `Bun.serve()` entry point. It imports the TTS worker pool and WebSocket handler from `packages/backend/audio` and binds them to the assigned development port.
- **Workspace Registration**: Add the new `apps/backend/voice` project to the `.moon/workspace.yml` configuration and scaffold its `package.json`, `moon.yml`, and `tsconfig.json`.

## State & Data Models
The `Bun.serve` implementation in the Voice microservice should conceptually look like this:

    Bun.serve({
        port: PORTS[mode].voice,
        fetch(req, server) {
            // Upgrade to WebSocket
            if (server.upgrade(req)) {
                return; // upgrade successful
            }
            return new Response("Voice API Status: OK", { status: 200 });
        },
        websocket: {
            message: ttsWebsocketHandler.onMessage,
            open: ttsWebsocketHandler.onOpen,
            close: ttsWebsocketHandler.onClose,
            // ... connect to the handler from packages/backend/audio
        }
    });

## Acceptance Criteria

- **AC1: Ports & Config Refactor**
  - Given the shared constants package
  - When inspected
  - Then `development_ports.ts` no longer contains a `game` port and successfully exports a `voice` port for all environment modes (emulator, staging, production).
  - Test Hook: Run `bun run typecheck` to ensure no other packages break due to the removed `game` port.

- **AC2: Tmux Scripts Refactored**
  - Given the tmux CLI commands
  - When executing `bun run scripts/src/index.ts tmux:start voice,pwa`
  - Then the orchestrator successfully creates the tmux session, splits the windows, and boots both the PWA and the new Voice microservice.
  - Test Hook: Review `start.ts` and `session.ts` to verify `game` is removed and the startup command for `voice` is mapped to `moon run voice:dev`.

- **AC3: Voice Microservice Bootstrapper**
  - Given the `apps/backend/voice` project
  - When the development server is started
  - Then it successfully boots a Bun HTTP/WebSocket server on the designated port and correctly binds the TTS worker pool.
  - Test Hook: Write a basic unit test in the `voice` app asserting the `Bun.serve` configuration or run it and ping the HTTP fallback for a 200 OK.

- **AC4: Workspace Integration**
  - Given the Moonrepo configuration
  - When `moon project voice` is executed
  - Then it successfully identifies the new project and its dependencies (e.g., `@aikami/backend-audio`, `@aikami/constants`).

## Implementation Notes
1. Start by updating the ports in `@aikami/constants`. Run a workspace typecheck to catch and fix any downstream breakages caused by removing `PORTS.game`.
2. Refactor the tmux scripts in `scripts/src/lib/tmux/`. The available services should now conceptually be `emulator`, `pwa`, `voice`, `all`.
3. Scaffold `apps/backend/voice`. Use a standard `package.json`, `tsconfig.json`, and `moon.yml` mimicking our existing backend patterns. 
4. In `apps/backend/voice/src/main.ts`, instantiate the TTS handler and boot the Bun server.
5. In your PWA's Voice Sandbox (`VoiceViewModel`), ensure the WebSocket URL is actually pointing to the new Voice service port (e.g., `ws://127.0.0.1:8081/ws`).

## Edge Cases & Gotchas
- **Tmux Session Naming**: If you encounter `exited with code 1` from the `tmux:start` script, it might be due to dangling tmux sessions in the background. Use the `--force` flag in your testing.
- **WebSocket Routing**: Ensure the PWA knows how to reach the Voice backend. You may need to inject the Voice port into the PWA's Vite environment config or hardcode it in the dev sandbox for now.

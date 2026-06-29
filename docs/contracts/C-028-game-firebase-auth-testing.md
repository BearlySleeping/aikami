// docs/contracts/C-028-game-firebase-auth-testing.md
# Contract C-028: Game Firebase REST Integration & Client Auth Handoff

## Core Objective
Establish a lightweight, REST-driven Firebase client within the PixiJS + bitECS game frontend (`apps/frontend/game`), bypassing the heavyweight Firebase JS SDK. Implement a "Device Flow" style authentication handoff to the Client (`apps/frontend/client`), and scaffold an automated blackbox testing pipeline via `tmux` and Playwright.

## Design References
- **Target App**: `apps/frontend/game/`
- **Client Auth Endpoint**: `apps/frontend/client/src/routes/(public)/auth/game/+page.svelte`
- **Lightweight Firebase Ref**: `examples/aikami-v2-godotjs/src/core/firebase/`
- **Testing Infrastructure**: `scripts/src/lib/test_blackbox/`

## Detailed Changes
1. **Lightweight Firebase SDK Migration**:
   - Port the existing REST/WebSocket Firebase abstractions from the `godotjs` example to `apps/frontend/game/src/core/firebase/`.
   - Update `http_client`, `auth`, `firestore`, `storage`, and `functions` to run within standard browser/WebGL contexts using `fetch`.
2. **Client Auth Handoff (Device Flow)**:
   - **Game**: Generates a temporary `auth_code` and prompts the user to visit `PWA_URL/auth/game?code=XYZ`. Begins polling a public Firebase Realtime Database/Firestore node for token validation.
   - **Client**: User logs in normally. Client writes a secure Custom Token or Session Token to the `XYZ` document.
   - **Game**: Retrieves the token, authenticates the lightweight REST client, and clears the temporary node.
3. **Blackbox Testing Pipeline**:
   - Create a specialized `game_e2e` suite in `scripts/src/lib/test_blackbox/`.
   - Pipeline steps:
     1. Spawn a background `tmux` session.
     2. Boot Firebase Emulators (`bun run emulate` in `apps/backend/firebase`).
     3. Await emulator health checks (Auth, Firestore, Storage, Functions).
     4. Execute headless tests via Playwright (`apps/frontend/game/tests/`).
     5. Assert state changes against emulator REST APIs.
     6. Teardown `tmux` session cleanly.

## Acceptance Criteria
- **Given** the user launches the game unauthenticated, **When** they request login, **Then** a shortcode is displayed directing them to the Client.
- **Given** the user logs into the Client with the shortcode, **Then** the game automatically receives the auth payload and authenticates its internal REST client without a refresh.
- **Given** a developer runs `bun run test:blackbox gateway --game`, **When** the script executes, **Then** a `tmux` session starts the emulators, a headless Playwright test verifies Auth/Firestore/Storage/Functions REST calls from the game, and the environment terminates cleanly with exit code `0`.

## Watch Points
- **Strictly prohibit** importing `firebase/app` or `firebase/auth` into `apps/frontend/game`. We must keep the WebGL payload minimal.
- Ensure the `tmux` cleanup hook catches `SIGINT` and `SIGTERM` to avoid zombie emulator processes.
- The Client auth endpoint must enforce strict CORS and origin validation when generating or passing custom tokens back to the game.

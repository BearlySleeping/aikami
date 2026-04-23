## Context

The GameJS project now has a working Firebase integration layer (`firebase_auth.ts`, `firebase_http_client.ts`, etc.) that supports email/password and anonymous authentication against Firebase emulators and production. However, there is no in-game UI for authentication — the only auth interaction is through a debug "Test Auth" button on the main menu. Players need a polished login experience before they can access cloud saves and leaderboards.

The SvelteKit PWA (`apps/frontend/pwa`) already handles user registration, email verification, and account management. We should not duplicate this in Godot. Instead, the Godot login view will handle **sign-in only** and delegate **sign-up** to the PWA via an external link.

## Goals / Non-Goals

**Goals:**
- Provide a native GodotJS login UI (email/password + Google sign-in)
- Automatically restore sessions on game launch
- Redirect new players to the SvelteKit PWA for registration
- Support both emulator and production Firebase configurations seamlessly

**Non-Goals:**
- Account registration inside Godot (delegated to PWA)
- Password reset inside Godot (delegated to PWA)
- Email verification inside Godot (delegated to PWA)
- Social sign-in beyond Google (can be added later)

## Decisions

**UI Framework: Godot Control nodes + custom styling**
- Rationale: The project already uses Godot UI for menus. No external UI framework is needed.
- Alternative: ImGui — rejected because it adds a dependency and doesn't match the existing aesthetic.

**Google Sign-In: Firebase REST API (`accounts:signInWithIdp`)**
- Rationale: GodotJS runs in a browser-like environment but cannot use the official Firebase JS SDK (no npm bundler support). The REST API is the only viable path.
- Flow: Open a browser window for Google OAuth → receive `id_token` → send to Firebase `signInWithIdp` endpoint.
- Alternative: OAuth 2.0 manual flow in Godot — rejected because it's significantly more complex and error-prone.

**Session Storage: `localStorage` via GodotJS `JavaScriptBridge`**
- Rationale: The auth service already stores tokens in `localStorage`. The login view will read/write the same keys.
- Key: `firebase_auth_session`

**PWA Link: Configurable via `Env` autoload**
- Rationale: The URL differs between emulator (`localhost:5173`) and production (`aikami.app`). The `Env` service already centralizes environment variables.

## Risks / Trade-offs

**[Risk]** Google Sign-In requires opening a browser window, which may be jarring on desktop builds.
→ **Mitigation**: On desktop, use `OS.shell_open()` to open the browser. On web builds, use `window.open()`. Provide clear messaging: "You will be redirected to Google to sign in."

**[Risk]** `JavaScriptBridge` is only available in web builds; desktop builds may not have `localStorage`.
→ **Mitigation**: Wrap `localStorage` access in a utility that falls back to an in-memory store on desktop. Since desktop is not the primary target for this project (it's a web-first PWA companion), this is acceptable.

**[Risk]** Players may have active sessions in the PWA but not in the game, or vice versa.
→ **Mitigation**: The game session is independent. If a player is logged into the PWA, they still need to log into the game. This is standard behavior for companion apps.

## Open Questions

- Should the login view be a popup overlay or a full-screen scene?
  - **Decision**: Full-screen scene for simplicity, can be refactored to overlay later.
- Should we show a "Skip" button for anonymous play?
  - **Decision**: Yes, but warn that cloud save and leaderboard will be unavailable.

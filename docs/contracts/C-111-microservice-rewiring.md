# Contract C-111: Microservice & Firebase Rewiring

## Context
In Contract C-102 (Tauri SPA Enforcement), we deleted our SvelteKit server routes (`+server.ts` and `+page.server.ts`) to ensure Tauri compilation. We commented out the `fetch()` calls in our frontend services that relied on those routes. We now need to rewire these client-side services to point directly to our local AI microservices (e.g., `apps/backend/text`) and Firebase Cloud Functions.

## Scope
- `apps/frontend/pwa/src/lib/services/ai/ai_text_intelligence_service.svelte.ts` (or wherever the `TODO` was left for text generation).
- `apps/frontend/pwa/src/lib/views/auth/game/auth_game_view_model.svelte.ts` (or wherever the `TODO` was left for auth handoff).
- `packages/shared/constants/src/lib/development_ports.ts` (or equivalent constants file).

## Acceptance Criteria
- [ ] **Text Microservice:** Find the `TODO` in the AI Text Intelligence Service. Replace the commented-out `fetch('/api/text')` with a direct call to the local text microservice (e.g., `http://127.0.0.1:<PORT>/generate`). The port should be imported from `@aikami/shared-constants`.
- [ ] **Auth Handoff:** Find the `TODO` for the auth device flow handoff. Replace the SvelteKit form action fetch (`fetch('?/completeHandoff')`) with the appropriate Firebase SDK call (e.g., a Callable Cloud Function or direct Firestore write).
- [ ] **CORS / Headers:** Ensure the new client-side `fetch` calls include the necessary headers (`Content-Type: application/json`) and that the target microservices are expected to handle CORS properly.
- [ ] **Cleanup:** Remove the `TODO` comments related to C-102/C-107 that were left behind.

## Implementation Notes
1. Check `packages/shared/constants` to find the correct local development port for the Text microservice. If it doesn't exist, define it (e.g., `export const TEXT_MICROSERVICE_PORT = 8000;`).
2. For the SSE (Server-Sent Events) text generation, ensure the frontend handles the stream correctly now that it's talking directly to the Python/Node backend instead of a SvelteKit middleman.
3. If the auth handoff requires backend secrets (which is why it was in `+page.server.ts`), you MUST move that specific logic into a Firebase Cloud Function inside `apps/backend/firebase/src/controllers/callable/` and call it via the Firebase client SDK `httpsCallable()`. Do not put secrets in the Tauri client.

## Edge Cases
- Make sure `localhost` vs `127.0.0.1` mismatches don't trigger CORS blocks in the browser during dev. Stick to `127.0.0.1` if possible.

---

## Execution Log — 2026-06-10

### Step 1: Search for TODO comments
Found two files with `TODO(C-102)` / `TODO(C-107)`:
- `apps/frontend/pwa/src/lib/services/ai/ai_text_intelligence_service.svelte.ts` — streamChat disabled, SSE reader renamed to `_readSSEStream_disabled`
- `apps/frontend/pwa/src/lib/views/auth/game/auth_game_view_model.svelte.ts` — `_completeHandoff()` throwing "temporarily disabled"

### Step 2: Wire AI Text Service → Ollama microservice
- Replaced `fetch('/api/text')` with `fetch('http://127.0.0.1:11436/api/generate')` using `EMULATOR_PORTS.text` from `@aikami/constants`
- Adapted stream reader from SSE `data:` format to Ollama NDJSON format (`_readOllamaNDJSONStream`)
- Re-enabled fetch timeout and stream read timeout constants
- Removed unused `body` object construction (Ollama only needs model + prompt)

### Step 3: Wire Auth Handoff → Callable Cloud Function
- Added `completeDeviceHandoff` event to `AuthApiEvents` in `packages/shared/types/src/lib/endpoints/auth.ts`
- Created handler `packages/backend/auth/src/lib/complete_device_handoff.ts` — creates custom Firebase token (Admin SDK, secrets stay server-side) + writes to Firestore `device_handoffs/{code}`
- Registered in `packages/backend/auth/src/index.ts` api_handler
- Added `completeDeviceHandoff()` method to `AuthServiceInterface` and `AuthService` class, routing through `callAuthEndpoint()` for type narrowing
- Replaced `fetch('?/completeHandoff')` form action in `_completeHandoff()` with `authService.completeDeviceHandoff({ code, uid })`

### Step 4: Cleanup
- Removed all `TODO(C-102)` / `TODO(C-107)` comments from both files
- Removed unused `_disabled` suffix from SSE stream reader (renamed to `_readOllamaNDJSONStream`)

### Verification
- `types:typecheck` ✅ 0 errors
- `pwa:typecheck` ✅ 0 errors, 0 warnings
- `pwa:fix` ✅ no new issues
- `backend-auth:fix` ✅ no issues (typecheck has pre-existing shared logger/utils ImportMeta errors — not from C-111)
- `backend-auth:typecheck` — only pre-existing `ImportMeta` issues in shared logger/utils; no C-111 errors

### Files Changed
1. `packages/shared/types/src/lib/endpoints/auth.ts` — added `completeDeviceHandoff` event
2. `packages/backend/auth/src/lib/complete_device_handoff.ts` — new file, handoff handler
3. `packages/backend/auth/src/index.ts` — registered `completeDeviceHandoff` in api_handler
4. `apps/frontend/pwa/src/lib/services/auth/auth_service.svelte.ts` — added `completeDeviceHandoff()` to interface + class
5. `apps/frontend/pwa/src/lib/services/ai/ai_text_intelligence_service.svelte.ts` — rewired to Ollama microservice, new NDJSON reader
6. `apps/frontend/pwa/src/lib/views/auth/game/auth_game_view_model.svelte.ts` — rewired `_completeHandoff()` to callable
7. `docs/contracts/PROGRESS.md` — marked C-111 completed

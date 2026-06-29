<!-- completed: 2026-06-29 -->
# Contract C-113: Tauri Desktop Sanity Check

## Context
We have successfully converted the frontend into a strictly statically-generated SPA (`@sveltejs/adapter-static`) and renamed the app from `pwa` to `client`. It is now time to boot the application inside the Tauri Rust shell (`bun tauri dev`) to verify that the desktop app compiles, the UI mounts successfully, and local microservices (like the Ollama text generator) can be reached without CORS or protocol errors.

## Scope
- `apps/frontend/client/src-tauri/tauri.conf.json`
- `apps/frontend/client/package.json` (Scripts)
- Core layout and asset loading files.

## Acceptance Criteria
- [ ] **Config Audit:** Verify `tauri.conf.json` points to the correct `beforeBuildCommand` and `beforeDevCommand` (e.g., using `bun run build` instead of outdated `pwa` commands) and that `frontendDist` points to the correct SvelteKit output folder (usually `../build`).
- [ ] **Desktop Boot:** Run the Tauri dev environment. The Rust shell must compile, and the SvelteKit UI must mount inside the desktop window without a "White Screen of Death".
- [ ] **Asset Resolution:** Verify that static assets (images, CSS) load correctly in the Tauri webview. (If not, SvelteKit's `paths.relative` configuration might need adjustment).
- [ ] **Microservice Connectivity:** Use the in-app DevTools (built in C-104) or the chat interface to trigger a call to the local text microservice. It must succeed without throwing a CORS or `fetch` network error.

## Implementation Notes
1. Before attempting to fix anything, just try to run it. Observe the console errors.
2. If assets are failing to load, check `svelte.config.js`. You may need to ensure `paths: { relative: false }` or check how base paths are handled in Tauri.
3. If API calls fail due to CORS, check the local Python backend (e.g., FastAPI/Flask CORS middleware) to ensure it accepts requests from `tauri://localhost` or `http://tauri.localhost`.

## Edge Cases
- Tauri's dev server (`bun tauri dev`) requires the Vite dev server to be running on the specified port. Ensure the ports match between `vite.config.ts` and `tauri.conf.json`.

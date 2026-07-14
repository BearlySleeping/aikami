<!-- completed: 2026-06-29 -->
# Contract C-102: Tauri SPA Enforcement

## Context
AiKami's frontend (`apps/frontend/client`) is wrapped in Tauri, meaning it MUST compile to a static Single Page Application (SPA). Tauri does not run a Node.js server, so SvelteKit `+server.ts` or `+page.server.ts` files will cause the Tauri build to fail. Any backend logic must be migrated to Firebase Functions or our local Python microservices later. Right now, we must forcefully strip the server-side code out of the SvelteKit app.

## Acceptance Criteria
- [ ] `apps/frontend/client/src/routes/api/text/+server.ts` is deleted.
- [ ] `apps/frontend/client/src/routes/(public)/auth/game/+page.server.ts` is deleted.
- [ ] `apps/frontend/client/src/routes/+layout.ts` enforces SPA mode by exporting `export const prerender = true;` and `export const ssr = false;`.
- [ ] `apps/frontend/client/svelte.config.js` uses `@sveltejs/adapter-static` with a fallback (e.g., `fallback: 'app.html'` or `index.html`).

## Implementation Notes
1. Search the `apps/frontend/client/src/routes` directory and completely delete any file ending in `.server.ts` or `+server.ts`. 
2. Update the root `+layout.ts` to strictly disable SSR and enable prerendering.
3. Review `svelte.config.js`. If it is using `adapter-auto` or `adapter-node`, switch it to `adapter-static`. Ensure the adapter configuration has a fallback set so client-side routing works.
4. If frontend components (like the text service or auth view) have broken imports because they were calling these server routes, comment out the fetch calls and add a `// TODO(C-107): Wire to microservice/firebase` note. Do not try to rebuild the logic right now.

## Edge Cases & Gotchas
- Deleting the `+server.ts` files *will* break the current local text generation and potentially the auth game flow. This is expected and intentional. We are breaking it now to rebuild it correctly via microservices in a future contract.
- Make sure `adapter-static` is installed in `package.json`. If not, add it.

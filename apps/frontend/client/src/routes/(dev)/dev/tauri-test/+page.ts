// apps/frontend/client/src/routes/(dev)/dev/tauri-test/+page.ts
//
// The app is a pure SPA (root +layout.ts sets ssr = false, prerender =
// false), so adapter-static emits only the index.html fallback and no
// per-route HTML. Tauri's asset protocol resolves `WebviewUrl::App("dev/
// tauri-test")` literally against frontendDist — with nothing at that path
// the window opens on a 404 instead of the route.
//
// Prerendering this one route emits `build/dev/tauri-test/index.html`. With
// ssr = false that is just the SPA shell, which boots the client router at
// the right URL — no server rendering, no runtime cost. This is what makes
// `bun moon run client:tauri-run -- --route /dev/tauri-test` work against a
// release binary; any other route wanting the same needs this same opt-in.
export const prerender = true;

// Emit `dev/tauri-test/index.html` rather than `dev/tauri-test.html`:
// Tauri's asset protocol resolves an extensionless request by appending
// `/index.html`, so the directory form is the one it can actually find.
export const trailingSlash = 'always';

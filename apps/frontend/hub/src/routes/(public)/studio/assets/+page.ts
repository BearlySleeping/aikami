// apps/frontend/hub/src/routes/(public)/studio/assets/+page.ts
//
// C-522 — Studio → Generation is a client-side surface once loaded.
//
// The dispatch list, artifact previews and review actions are session-scoped
// fetches made after hydration; `ssr = false` keeps those from rendering twice
// (and keeps a private preview URL out of the server-rendered HTML).

export const ssr = false;

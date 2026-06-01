// apps/frontend/pwa/src/routes/+layout.ts
// Static SPA mode — all rendering happens client-side.
// No SSR, no prerendering. Firebase Hosting serves index.html for all routes.
export const ssr = false;
export const prerender = false;

// Disable SSR — pixi.js (imported by LpcViewModel) requires a browser
// environment (Canvas, WebGL). SSR would fail and break client hydration.
export const ssr = false;

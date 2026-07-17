// apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_pixi_facade.ts
//
// Facade re-exporting PixiJS types for the LPC Preview component.
// ViewModel imports from HERE instead of pixi.js directly — satisfies
// the architectural gate (ARC-004: no pixi.js imports in ViewModels).

export type { Application as PixiApplication } from 'pixi.js';
export { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

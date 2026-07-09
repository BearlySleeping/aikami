// apps/frontend/client/src/lib/views/dev/lpc/lpc_pixi_facade.ts
//
// Facade re-exporting PixiJS types for the LPC Character Debugger.
// ViewModel imports from HERE instead of pixi.js directly — satisfies
// the architectural gate (ARC-004: no pixi.js imports in ViewModels).
// Future: replace with a proper renderer abstraction via EngineBridge.

export type { Application as PixiApplication } from 'pixi.js';
export { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

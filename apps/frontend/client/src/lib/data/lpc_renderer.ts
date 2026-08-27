// apps/frontend/client/src/lib/data/lpc_renderer.ts
// Single source of truth for LPC texture loading and frame extraction.
// Used by: LPC dev page, sandbox, game engine, character creation preview.
//
// 🔴 Re-export shim — the LPC renderer has moved to @aikami/frontend/preview.
// This file exists for backward compatibility during the C-445 transition.
// New code should import from '@aikami/frontend/preview' directly.

export type { LpcRenderer, LpcSheetLayout } from '@aikami/frontend/preview';
export {
  createLpcRenderer,
  detectLpcSheetLayout,
  getLpcSpriteAnchor,
} from '@aikami/frontend/preview';

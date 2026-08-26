// apps/frontend/client/src/lib/data/lpc_renderer.ts
//
// 🔴 Re-export shim — the LPC renderer has moved to @aikami/frontend/preview.
// This file exists for backward compatibility during the C-445 transition.
// New code should import from '@aikami/frontend/preview' directly.

export {
  createLpcRenderer,
  detectLpcSheetLayout,
  getLpcSpriteAnchor,
} from '@aikami/frontend/preview';
export type { LpcRenderer, LpcSheetLayout } from '@aikami/frontend/preview';

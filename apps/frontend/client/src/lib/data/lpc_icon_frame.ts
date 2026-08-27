// apps/frontend/client/src/lib/data/lpc_icon_frame.ts
//
// 🔴 Re-export shim — icon frame helpers have moved to @aikami/frontend/preview.
// This file exists for backward compatibility during the C-445 transition.
// New code should import from '@aikami/frontend/preview' directly.

export type { LpcGrid } from '@aikami/frontend/preview';
export {
  getLpcGrid,
  getLpcIconBackgroundPosition,
  getLpcIconBackgroundSize,
  getLpcIconCellPitch,
  pickHeroCell,
} from '@aikami/frontend/preview';

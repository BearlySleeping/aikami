// packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts
//
// Re-export from @aikami/lpc — the canonical source for LPC sheet geometry.
// This file is kept as a backward-compat re-export hub for engine-internal
// imports. New code should import from @aikami/lpc directly.

export type { LpcCellFamily, LpcSheetGeometry } from '@aikami/lpc';
export { resolveLpcSheetGeometry } from '@aikami/lpc';

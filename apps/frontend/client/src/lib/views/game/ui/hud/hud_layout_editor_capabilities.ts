// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_capabilities.ts
//
// C-528 AC-2 — what the editor is allowed to reach.
//
// 🔴 The ViewModel owns no authority: it reads the draft, mutates the draft and
// measures the viewport, all through these three narrow contracts. They live
// here so the production wiring in `hud_layout_editor_composition.ts` and the
// fixtures in the ViewModel's tests are visibly the same shape, and so the
// editor's own file is about behaviour rather than about what it is handed.
//
// The editor takes a DRAFT, never the committed snapshot, and only `save()`
// crosses that line. That is the whole of AC-3's transaction boundary, stated
// as a type.

import type { HudUserPreferences } from '@aikami/schemas';
import type { HudViewport } from '$lib/utils/hud/hud_layout_policy.ts';
import type { HudEditorCommand } from '$lib/utils/hud/hud_layout_state.ts';
import type { HudEditorBoardRow } from './hud_layout_editor_placement.ts';

/** The HUD authority the editor writes drafts through. */
export type HudEditorPreferenceCapabilities = {
  readonly preferences: HudUserPreferences;
  readonly draft: HudUserPreferences;
  readonly isDirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isEditorEnabled: boolean;
  readonly recoveryNotice: string | undefined;
  beginEdit(): void;
  dispatch(command: HudEditorCommand): void;
  save(): void;
  cancel(): void;
  exportPreset(name: string): unknown;
  importPreset(preset: unknown): { reason: string } | undefined;
};

/** Session-scoped HUD visibility controlled from the editor header. */
export type HudEditorVisibilityCapabilities = {
  readonly isHudTemporarilyHidden: boolean;
  toggleHudTemporarilyHidden(): void;
};

/** Measurement the preview reflows against. */
export type HudEditorViewportCapabilities = {
  readonly viewport: HudViewport;
  readonly textScale: number;
};

/** One editable widget row. A placement row is a row: same shape, both panels. */
export type HudEditorWidgetRow = HudEditorBoardRow;

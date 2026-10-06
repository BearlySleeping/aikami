// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_presets.ts
//
// C-528 AC-8 — the editor's preset exchange.
//
// 🔴 Untrusted bytes in, a sentence out. The size check runs BEFORE the parse
// so an oversized file is never materialised as an object graph, and every
// rejection names its reason: a preset import that fails silently is a preset
// the player believes they applied and did not.
//
// This is not part of placement and not part of the edit machine. It touches
// the DRAFT through the same `importPreset` capability every other writer uses,
// so an imported layout is undoable exactly like a dragged one.

import { isHudLayoutJsonWithinSizeLimit } from '@aikami/schemas';

/** What a preset import resolved to. */
export type HudEditorPresetImport =
  | { readonly ok: true; readonly preset: unknown }
  | { readonly ok: false; readonly message: string };

/** Parses and size-checks an uploaded preset, or explains why it cannot be. */
export const readHudEditorPresetJson = (raw: string): HudEditorPresetImport => {
  if (!isHudLayoutJsonWithinSizeLimit(raw)) {
    return { ok: false, message: 'That preset file is too large.' };
  }
  try {
    return { ok: true, preset: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, message: 'That preset file is not valid JSON.' };
  }
};

/** Turns a rejected import into the sentence the status line shows. */
export const hudEditorImportFailureMessage = (reason: string): string =>
  reason === 'missing-required-widget'
    ? 'That preset is missing a required HUD surface and cannot be used.'
    : 'That preset could not be read.';

/** The name an exported layout carries until the player renames it. */
export const HUD_EDITOR_EXPORT_NAME = 'Shared layout';

/** Serialises a preset for download. Indented, because players read these. */
export const hudEditorExportPresetJson = (preset: unknown): string =>
  JSON.stringify(preset, undefined, 2);

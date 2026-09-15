// apps/frontend/client/src/lib/services/settings/hud_preference_service.svelte.ts
//
// HudPreferenceService — the ONE authority for the player's HUD layout intent
// (C-528 Directive 11).
//
// Before this service the HUD was a set of independent booleans: the overlay
// router owned the gameplay visibility rules, QuestOverlayService owned
// `aikami:quest-overlay:visible`, MusicPlayerService owned
// `aikami:music-player:visible`, and a reactive module owned
// `aikami:clock-hud:visible`. Nothing could answer "what is the HUD", so the
// editor, the settings page and the in-game toggles could not agree.
//
// This service owns:
//   - the versioned, atomic device-local snapshot (`aikami:hud:preferences`)
//   - the one-shot legacy migration (`aikami:hud:migration`)
//   - the transactional editor session (draft, undo/redo, save/cancel)
//   - temporary Hide HUD (session-scoped, never a persisted preference)
//
// It owns NO accessibility selection: motion stays in MotionPreferenceService
// and is read at resolve time. It owns no theme choice, no keybindings, no
// campaign data.
//
// Contract: C-528 AC-1, AC-3, AC-6, AC-7, AC-8.

import {
  HUD_HIDDEN_STORAGE_KEY,
  HUD_MIGRATION_MARKER_KEY,
  HUD_PREFERENCES_STORAGE_KEY,
  HUD_WIDGET_IDS,
  LEGACY_CLOCK_HUD_VISIBLE_KEY,
  LEGACY_MUSIC_PLAYER_VISIBLE_KEY,
  LEGACY_QUEST_OVERLAY_VISIBLE_KEY,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import {
  type HudLayoutPreset,
  type HudUserPreferences,
  parseHudMigrationMarkerJson,
  parseHudUserPreferencesJson,
} from '@aikami/schemas';
import {
  applyHudEditorCommand,
  createHudEditorState,
  exportHudPreset,
  type HudEditorCommand,
  type HudEditorState,
  type HudPresetImportFailure,
  hudEditorCanRedo,
  hudEditorCanUndo,
  hudEditorIsDirty,
  importHudPreset,
  resetHudLayout,
} from '$lib/utils/hud/hud_layout_state.ts';
import {
  defaultHudPreferences,
  type HudLegacySnapshot,
  hasHudLegacyValues,
  isKnownHudPreferenceVersion,
  migrateHudLegacyPreferences,
} from '$lib/utils/hud/hud_preference_migration.ts';

export type HudPreferenceServiceOptions = BaseFrontendClassOptions;

export type HudPreferenceServiceInterface = BaseFrontendClassInterface & {
  /** The committed snapshot the resolver reads. */
  readonly preferences: HudUserPreferences;
  /** Whether the editor can be opened at all (rollback switch). */
  readonly isEditorEnabled: boolean;
  /** Whether the HUD is temporarily hidden for this session. */
  readonly isHudTemporarilyHidden: boolean;
  /** Human-readable notice when stored data could not be used. */
  readonly recoveryNotice: string | undefined;
  /** Ids the player has preferences for that this build does not register. */
  readonly dormantWidgetIds: readonly string[];

  // ── Editor session (transactional) ──
  readonly draft: HudUserPreferences;
  readonly isDirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  beginEdit(): void;
  dispatch(command: HudEditorCommand): void;
  save(): void;
  cancel(): void;

  // ── Immediate (settings page) ──
  applyNow(command: HudEditorCommand): boolean;
  selectPreset(presetId: string): void;
  resetWidget(widgetId: string): void;
  restoreDefaults(): void;

  // ── Temporary Hide HUD ──
  toggleHudTemporarilyHidden(): void;
  setHudTemporarilyHidden(hidden: boolean): void;

  // ── Rollback switch ──
  setEditorEnabled(enabled: boolean): void;

  // ── Exchange ──
  exportPreset(name: string): HudLayoutPreset;
  importPreset(preset: unknown): HudPresetImportFailure | undefined;

  /** Re-reads storage and re-runs a not-yet-committed migration (idempotent). */
  initialize(): Promise<void>;
};

/** Trusted registry ids. Local copy so the service never imports the view layer. */
const HUD_REGISTERED_IDS: ReadonlySet<string> = new Set<string>(HUD_WIDGET_IDS);

const isRegisteredWidget = (widgetId: string): boolean => HUD_REGISTERED_IDS.has(widgetId);

/** Ids present in the snapshot's overrides that this build does not register. */
const dormantIdsOf = (preferences: HudUserPreferences): readonly string[] =>
  preferences.overrides
    .map((override) => override.widgetId)
    .filter((widgetId) => !isRegisteredWidget(widgetId));

class HudPreferenceService
  extends BaseFrontendClass<HudPreferenceServiceOptions>
  implements HudPreferenceServiceInterface
{
  /** The committed snapshot — the only thing the resolver ever reads. */
  preferences = $state<HudUserPreferences>(defaultHudPreferences());
  isEditorEnabled = $state<boolean>(true);
  isHudTemporarilyHidden = $state<boolean>(false);
  recoveryNotice = $state<string | undefined>(undefined);
  draft = $state<HudUserPreferences>(defaultHudPreferences());
  isDirty = $state<boolean>(false);
  canUndo = $state<boolean>(false);
  canRedo = $state<boolean>(false);

  /** Undo/redo history for the editor session. */
  private _editorState: HudEditorState = createHudEditorState(defaultHudPreferences());

  constructor(options: HudPreferenceServiceOptions) {
    super(options);
    // 🔴 Restore at construction, NOT only in an explicit `initialize()`.
    // Two independent entry points read this preference — the game boot and
    // `/settings?section=interface` — and a restore that lives only in
    // `initialize()` is one forgotten call site away from showing the player a
    // default they never chose. Owning it here removes that failure mode.
    this._restore();
    this._restoreTemporaryHidden();
  }

  /** @inheritdoc */
  get dormantWidgetIds(): readonly string[] {
    return dormantIdsOf(this.preferences);
  }

  // ── Editor session ──

  /** @inheritdoc */
  beginEdit(): void {
    if (!this.isEditorEnabled) {
      this.debug('beginEdit:disabled');
      return;
    }
    this._setEditorState(createHudEditorState(this.preferences));
  }

  /** @inheritdoc */
  dispatch(command: HudEditorCommand): void {
    if (!this.isEditorEnabled) {
      return;
    }
    this._setEditorState(applyHudEditorCommand(this._editorState, command));
  }

  /** @inheritdoc */
  save(): void {
    if (!this.isEditorEnabled) {
      return;
    }
    this._setEditorState(applyHudEditorCommand(this._editorState, { kind: 'save' }));
    this._persist();
  }

  /** @inheritdoc */
  cancel(): void {
    this._setEditorState(applyHudEditorCommand(this._editorState, { kind: 'cancel' }));
  }

  // ── Immediate (settings page) ──

  /** @inheritdoc */
  applyNow(command: HudEditorCommand): boolean {
    if (!this.isEditorEnabled) {
      return false;
    }
    this._setEditorState(applyHudEditorCommand(this._editorState, command));
    this._setEditorState(applyHudEditorCommand(this._editorState, { kind: 'save' }));
    this._persist();
    return true;
  }

  /** @inheritdoc */
  selectPreset(presetId: string): void {
    this.applyNow({ kind: 'apply-preset', presetId });
  }

  /** @inheritdoc */
  resetWidget(widgetId: string): void {
    if (!isRegisteredWidget(widgetId)) {
      return;
    }
    this.applyNow({ kind: 'reset-widget', widgetId: widgetId as never });
  }

  /** @inheritdoc */
  restoreDefaults(): void {
    if (this.applyNow({ kind: 'reset-layout' })) {
      this.recoveryNotice = undefined;
    }
  }

  // ── Temporary Hide HUD ──

  /** @inheritdoc */
  toggleHudTemporarilyHidden(): void {
    this.setHudTemporarilyHidden(!this.isHudTemporarilyHidden);
  }

  /**
   * Hides the HUD for this session only.
   *
   * Deliberately NOT part of the preference snapshot: Hide HUD is a temporary,
   * reversible view state, and a reload must always bring the chrome back.
   * Required surfaces (Menu, system notices) are never hidden by it — the
   * resolver enforces that independently of this flag.
   */
  setHudTemporarilyHidden(hidden: boolean): void {
    this.isHudTemporarilyHidden = hidden;
    try {
      sessionStorage.setItem(HUD_HIDDEN_STORAGE_KEY, hidden ? '1' : '0');
    } catch {
      // sessionStorage unavailable — in-memory only
    }
    this.debug('setHudTemporarilyHidden', { hidden });
  }

  // ── Rollback switch ──

  /**
   * Disables the editor and falls back to the shipped safe layout.
   *
   * Used by the rollback path: customization can be switched off without
   * deleting the stored snapshot, unrelated preferences or any save.
   */
  setEditorEnabled(enabled: boolean): void {
    this.isEditorEnabled = enabled;
    // Re-publish the snapshot the resolver reads: the stored intent while the
    // editor is available, the shipped safe layout while customization is
    // switched off. Nothing is written to storage either way.
    this._setEditorState(this._editorState);
    this.debug('setEditorEnabled', { enabled });
  }

  // ── Exchange ──

  /** @inheritdoc */
  exportPreset(name: string): HudLayoutPreset {
    // Accessibility selections, device ids and campaign references are not part
    // of this shape at all, so they cannot leak into an export.
    return exportHudPreset({
      preferences: this.preferences,
      id: this.preferences.selectedPresetId,
      name,
    });
  }

  /** @inheritdoc */
  importPreset(preset: unknown): HudPresetImportFailure | undefined {
    if (!this.isEditorEnabled) {
      return undefined;
    }
    const result = importHudPreset({ current: this.preferences, preset });
    if (!result.ok) {
      this.warn('importPreset:rejected', { reason: result.reason });
      if (result.reason === 'missing-required-widget') {
        return { reason: 'missing-required-widget', widgetIds: result.widgetIds };
      }
      return { reason: 'invalid-preset' };
    }
    this._setEditorState(createHudEditorState(result.preferences));
    this._persist();
    return undefined;
  }

  // ── Lifecycle ──

  /** @inheritdoc */
  async initialize(): Promise<void> {
    this._restore();
    this._restoreTemporaryHidden();
  }

  // ── Private ──

  private _setEditorState(state: HudEditorState): void {
    this._editorState = state;
    this.draft = state.draft;
    this.preferences = this.isEditorEnabled ? state.committed : resetHudLayout();
    this.isDirty = hudEditorIsDirty(state);
    this.canUndo = hudEditorCanUndo(state);
    this.canRedo = hudEditorCanRedo(state);
  }

  /** Writes the committed snapshot. The only place storage is mutated. */
  private _persist(): void {
    try {
      localStorage.setItem(
        HUD_PREFERENCES_STORAGE_KEY,
        JSON.stringify(this._editorState.committed),
      );
    } catch {
      // localStorage unavailable (SSR/privacy mode) — in-memory only
      this.warn('persist:unavailable');
    }
    this.debug('persist', {
      preset: this._editorState.committed.selectedPresetId,
      overrides: this._editorState.committed.overrides.length,
    });
  }

  /** Reads the snapshot, migrating the legacy keys exactly once. */
  private _restore(): void {
    const raw = this._readKey(HUD_PREFERENCES_STORAGE_KEY);
    if (raw !== undefined) {
      const parsed = parseHudUserPreferencesJson(raw);
      if (parsed) {
        this._setEditorState(createHudEditorState(parsed));
        this.recoveryNotice = undefined;
        return;
      }
      // Unusable. Keep the bytes; never rewrite them destructively.
      const future = !isKnownHudPreferenceVersion(raw);
      this.recoveryNotice = future
        ? 'Your HUD layout was saved by a newer version of Aikami. The default layout is in use; your stored layout is untouched.'
        : 'Your HUD layout could not be read. The default layout is in use.';
      this.warn('restore:fallback', { futureVersion: future });
      this._applyFallback();
      return;
    }

    // No snapshot yet — migrate the legacy keys once, if any are present.
    if (this._hasMigrationMarker()) {
      this._applyFallback();
      return;
    }
    const legacy: HudLegacySnapshot = {
      questOverlayVisible: this._readKey(LEGACY_QUEST_OVERLAY_VISIBLE_KEY),
      musicPlayerVisible: this._readKey(LEGACY_MUSIC_PLAYER_VISIBLE_KEY),
      clockHudVisible: this._readKey(LEGACY_CLOCK_HUD_VISIBLE_KEY),
    };
    const outcome = migrateHudLegacyPreferences(legacy, new Date().toISOString());
    this._setEditorState(createHudEditorState(outcome.preferences));
    this.recoveryNotice = undefined;
    // Commit the migrated values and the marker together, then leave the old
    // keys intact for the rollback window.
    try {
      localStorage.setItem(HUD_PREFERENCES_STORAGE_KEY, JSON.stringify(outcome.preferences));
      localStorage.setItem(HUD_MIGRATION_MARKER_KEY, JSON.stringify(outcome.marker));
    } catch {
      // Storage unavailable — the in-memory migration still applies this session.
    }
    this.debug('migrate', {
      legacyKeys: outcome.migratedKeys.length,
      hadLegacyValues: hasHudLegacyValues(legacy),
    });
  }

  private _applyFallback(): void {
    this._setEditorState(createHudEditorState(defaultHudPreferences()));
  }

  private _hasMigrationMarker(): boolean {
    const raw = this._readKey(HUD_MIGRATION_MARKER_KEY);
    if (raw === undefined) {
      return false;
    }
    if (parseHudMigrationMarkerJson(raw)) {
      return true;
    }
    // A corrupt marker must not block migration forever — treat it as unset.
    return false;
  }

  private _readKey(key: string): string | undefined {
    try {
      const value = localStorage.getItem(key);
      return value === null ? undefined : value;
    } catch {
      return undefined;
    }
  }

  private _restoreTemporaryHidden(): void {
    try {
      this.isHudTemporarilyHidden = sessionStorage.getItem(HUD_HIDDEN_STORAGE_KEY) === '1';
    } catch {
      this.isHudTemporarilyHidden = false;
    }
  }
}

export const hudPreferenceService: HudPreferenceServiceInterface = HudPreferenceService.create({
  className: 'HudPreferenceService',
});

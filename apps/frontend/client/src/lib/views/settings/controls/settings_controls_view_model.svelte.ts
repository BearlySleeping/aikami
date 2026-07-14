// apps/frontend/client/src/lib/views/settings/controls/settings_controls_view_model.svelte.ts
//
// SettingsControlsViewModel — keybinding configuration persisted to
// localStorage. Actions are game-level controls (move, interact, menu).

import { DEFAULT_KEYBINDINGS, KEYBINDING_STORAGE_KEY } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ControlAction = {
  readonly id: string;
  readonly label: string;
};

/** A record mapping action ids to their current keybinding. */
export type KeybindingMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsControlsViewModelInterface = BaseViewModelInterface & {
  /** All configurable control actions. */
  readonly actions: readonly ControlAction[];
  /** Current keybinding map (action id → key name). */
  readonly bindings: KeybindingMap;
  /** The action currently awaiting a new key press, or null. */
  readonly listeningActionId: string | null;

  /** Begins listening for a new keybinding for the given action. */
  startListening(actionId: string): void;
  /** Cancels the current keybinding capture. */
  cancelListening(): void;
  /** Resets all keybindings to defaults. */
  resetDefaults(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingsControlsViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = KEYBINDING_STORAGE_KEY;

const DEFAULT_ACTIONS: readonly ControlAction[] = [
  { id: 'move_up', label: 'Move Up' },
  { id: 'move_down', label: 'Move Down' },
  { id: 'move_left', label: 'Move Left' },
  { id: 'move_right', label: 'Move Right' },
  { id: 'interact', label: 'Interact' },
  { id: 'open_menu', label: 'Open Menu' },
] as const;

const DEFAULT_BINDINGS: KeybindingMap = { ...DEFAULT_KEYBINDINGS };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SettingsControlsViewModel
  extends BaseViewModel<SettingsControlsViewModelOptions>
  implements SettingsControlsViewModelInterface
{
  readonly actions: readonly ControlAction[] = DEFAULT_ACTIONS;
  bindings: KeybindingMap = $state({ ...DEFAULT_BINDINGS });
  listeningActionId: string | null = $state(null);

  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  override async initialize(): Promise<void> {
    this.loadFromStorage();
    await super.initialize();
  }

  override async dispose(): Promise<void> {
    this.removeKeyListener();
    await super.dispose();
  }

  startListening(actionId: string): void {
    // Cancel any previous listener
    this.removeKeyListener();

    this.listeningActionId = actionId;

    this._keydownHandler = (e: KeyboardEvent) => {
      e.preventDefault();

      const keyName = this.formatKeyName(e);
      this.bindings = { ...this.bindings, [actionId]: keyName };
      this.persistToStorage();
      this.removeKeyListener();
      this.listeningActionId = null;
    };

    window.addEventListener('keydown', this._keydownHandler);
  }

  cancelListening(): void {
    this.removeKeyListener();
    this.listeningActionId = null;
  }

  resetDefaults(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.persistToStorage();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private formatKeyName(e: KeyboardEvent): string {
    // Use event.key directly — single chars stay lowercase (e.g. "w")
    // so the engine's keyToDirection can match them case-insensitively.
    // Modifier combos are stored as "Ctrl+W" style strings.
    const parts: string[] = [];
    if (e.ctrlKey) {
      parts.push('Ctrl');
    }
    if (e.altKey) {
      parts.push('Alt');
    }
    if (e.shiftKey) {
      parts.push('Shift');
    }
    const key = e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' ? '' : e.key;
    if (key) {
      parts.push(key);
    }
    return parts.length > 0 ? parts.join('+') : '---';
  }

  private persistToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      // localStorage may be unavailable
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.bindings = { ...DEFAULT_BINDINGS, ...JSON.parse(stored) };
      }
    } catch {
      // Invalid stored data — keep defaults
    }
  }

  private removeKeyListener(): void {
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
      this._keydownHandler = null;
    }
  }
}

export const getSettingsControlsViewModel = (
  options: SettingsControlsViewModelOptions,
): SettingsControlsViewModelInterface => SettingsControlsViewModel.create(options);

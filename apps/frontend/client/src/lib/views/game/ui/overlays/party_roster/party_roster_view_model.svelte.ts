// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_view_model.svelte.ts
//
// Party roster overlay ViewModel — manages the party roster overlay UI state.
// Displays member list with approval bars, stats, and Talk/Equipment/Dismiss
// buttons.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/party_roster_fixtures.ts).
// Production wiring lives in ./party_roster_composition.ts.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { PartyRosterEntry } from '@aikami/types';

// ── Capability contracts ────────────────────────────────────────────────

/** The roster state and operations the overlay reads. */
export type PartyRosterCapabilities = {
  readonly members: readonly PartyRosterEntry[];
  readonly maxSize: number;
  isEmpty(): boolean;
  dismiss(npcId: string): boolean;
};

/** The engine operations needed to strip Companion.recruited on dismiss. */
export type PartyRosterEngineCapabilities = {
  getEntityIdForNpc(npcId: string): number | undefined;
  sendCommand(command: {
    type: 'SET_COMPANION_RECRUITED';
    entityId: number;
    recruited: boolean;
  }): void;
};

/** The overlay operations the roster performs. */
export type PartyRosterOverlayCapabilities = {
  openTalkToParty(options: { npcId: string; name: string }): void;
  openCharacterDashboard(): void;
  closePartyRoster(): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type PartyRosterViewModelOptions = BaseViewModelOptions & {
  /** Roster capability. */
  roster: PartyRosterCapabilities;
  /** Engine capability. */
  engine: PartyRosterEngineCapabilities;
  /** Overlay capability. */
  overlay: PartyRosterOverlayCapabilities;
};

export type PartyRosterViewModelInterface = BaseViewModelInterface & {
  readonly members: readonly PartyRosterEntry[];
  readonly maxSize: number;
  readonly isEmpty: boolean;
  readonly showConfirmDismiss: boolean;
  readonly confirmDismissNpcId: string;
  readonly confirmDismissName: string;

  /** Dismiss a companion (with confirmation). */
  requestDismiss(options: { npcId: string; name: string }): void;
  confirmDismiss(): void;
  cancelDismiss(): void;

  /** Open Talk to Party for a companion. */
  talkToCompanion(options: { npcId: string; name: string }): void;

  /** Open equipment/character dashboard for a companion. */
  viewEquipment(options: { npcId: string }): void;

  /** Close the overlay. */
  handleBackdropClick(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  handleDismissKeyDown(event: KeyboardEvent): void;
  close(): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class PartyRosterViewModel
  extends BaseViewModel<PartyRosterViewModelOptions>
  implements PartyRosterViewModelInterface
{
  private readonly _roster: PartyRosterCapabilities;
  private readonly _engine: PartyRosterEngineCapabilities;
  private readonly _overlay: PartyRosterOverlayCapabilities;

  showConfirmDismiss = $state<boolean>(false);
  confirmDismissNpcId = $state<string>('');
  confirmDismissName = $state<string>('');

  constructor(options: PartyRosterViewModelOptions) {
    super(options);
    this._roster = options.roster;
    this._engine = options.engine;
    this._overlay = options.overlay;
  }

  get members(): readonly PartyRosterEntry[] {
    return this._roster.members;
  }

  get maxSize(): number {
    return this._roster.maxSize;
  }

  get isEmpty(): boolean {
    return this._roster.isEmpty();
  }

  /** @inheritdoc */
  requestDismiss(options: { npcId: string; name: string }): void {
    this.confirmDismissNpcId = options.npcId;
    this.confirmDismissName = options.name;
    this.showConfirmDismiss = true;
  }

  /** @inheritdoc */
  confirmDismiss(): void {
    if (this.confirmDismissNpcId) {
      const dismissed = this._roster.dismiss(this.confirmDismissNpcId);
      if (dismissed) {
        // Strip Companion.recruited on the ECS entity so it stops following
        // and drops out of the combat turn order (C-340 AC-1).
        const entityId = this._engine.getEntityIdForNpc(this.confirmDismissNpcId);
        if (entityId !== undefined) {
          this._engine.sendCommand({
            type: 'SET_COMPANION_RECRUITED',
            entityId,
            recruited: false,
          });
        }
      }
    }
    this.showConfirmDismiss = false;
    this.confirmDismissNpcId = '';
    this.confirmDismissName = '';
  }

  /** @inheritdoc */
  cancelDismiss(): void {
    this.showConfirmDismiss = false;
    this.confirmDismissNpcId = '';
    this.confirmDismissName = '';
  }

  /** @inheritdoc */
  talkToCompanion(options: { npcId: string; name: string }): void {
    this._overlay.openTalkToParty(options);
    this.debug('talkToCompanion', { npcId: options.npcId });
  }

  /** @inheritdoc */
  viewEquipment(_options: { npcId: string }): void {
    // Open character dashboard scoped to this companion
    this._overlay.openCharacterDashboard();
    this.debug('viewEquipment', { npcId: _options.npcId });
  }

  /** Closes the roster when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  /** Closes the roster when Escape is pressed. */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    }
  }

  /** Cancels dismissal without allowing Escape to close the roster. */
  handleDismissKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelDismiss();
    }
  }

  /** @inheritdoc */
  close(): void {
    this._overlay.closePartyRoster();
  }
}

/**
 * Builds a party-roster ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getPartyRosterViewModel` in ./party_roster_composition.ts.
 */
export const createPartyRosterViewModel = (
  options: PartyRosterViewModelOptions,
): PartyRosterViewModelInterface => PartyRosterViewModel.create(options);

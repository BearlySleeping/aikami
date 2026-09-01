// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_view_model.svelte.ts
//
// Party roster overlay ViewModel — manages the party roster overlay UI state.
// Displays member list with approval bars, stats, and Talk/Equipment/Dismiss buttons.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PartyRosterEntry } from '@aikami/types';
import { gameEngineService, gameOverlayService, partyRosterService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartyRosterViewModelOptions = BaseViewModelOptions;

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

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PartyRosterViewModel
  extends BaseViewModel<PartyRosterViewModelOptions>
  implements PartyRosterViewModelInterface
{
  showConfirmDismiss = $state<boolean>(false);
  confirmDismissNpcId = $state<string>('');
  confirmDismissName = $state<string>('');

  get members(): readonly PartyRosterEntry[] {
    return partyRosterService.members;
  }

  get maxSize(): number {
    return partyRosterService.maxSize;
  }

  get isEmpty(): boolean {
    return partyRosterService.isEmpty();
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
      const dismissed = partyRosterService.dismiss(this.confirmDismissNpcId);
      if (dismissed) {
        // Strip Companion.recruited on the ECS entity so it stops following
        // and drops out of the combat turn order (C-340 AC-1).
        const entityId = gameEngineService.getEntityIdForNpc(this.confirmDismissNpcId);
        if (entityId !== undefined) {
          gameEngineService.sendCommand({
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
    gameOverlayService.openTalkToParty(options);
    this.debug('talkToCompanion', { npcId: options.npcId });
  }

  /** @inheritdoc */
  viewEquipment(_options: { npcId: string }): void {
    // Open character dashboard scoped to this companion
    gameOverlayService.openCharacterDashboard();
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
    gameOverlayService.closePartyRoster();
  }
}

export const getPartyRosterViewModel = (
  options: PartyRosterViewModelOptions,
): PartyRosterViewModelInterface => PartyRosterViewModel.create(options);

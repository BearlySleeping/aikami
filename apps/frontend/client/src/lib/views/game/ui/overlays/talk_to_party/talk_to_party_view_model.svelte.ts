// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte.ts
//
// Talk to Party overlay ViewModel — companion-specific dialogue when
// initiating conversation with an already-recruited party member.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures. Production wiring lives in
// ./talk_to_party_composition.ts.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { PartyRosterEntry } from '@aikami/types';

// ── Capability contracts ────────────────────────────────────────────────

/** The single dialogue-generation call the companion overlay makes. */
export type TalkToPartyDialogueCapabilities = {
  generateTurn(options: {
    npcId: string;
    npcName: string;
    messages: Array<{ role: 'player' | 'npc'; content: string }>;
    signal: AbortSignal;
  }): Promise<{ narrative: string }>;
};

/** The party-roster reads the companion dialogue needs. */
export type TalkToPartyRosterCapabilities = {
  getMember(npcId: string): PartyRosterEntry | undefined;
  getApproval(npcId: string): number;
};

/** The overlay-navigation capability invoked when the overlay closes. */
export type TalkToPartyOverlayCapabilities = {
  clearStack(): void;
  openPartyRoster(): void;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TalkToPartyViewModelOptions = BaseViewModelOptions & {
  /** The companion's NPC ID. */
  npcId: string;
  /** The companion's display name. */
  npcName: string;
  /** NPC dialogue orchestrator — handles AI streaming and authored fallback. */
  npcDialogueService: TalkToPartyDialogueCapabilities;
  /** Party-roster reads. */
  partyRoster: TalkToPartyRosterCapabilities;
  /** Overlay navigation. */
  overlays: TalkToPartyOverlayCapabilities;
};

export type TalkToPartyViewModelInterface = BaseViewModelInterface & {
  readonly npcName: string;
  readonly npcId: string;
  readonly approval: number;
  readonly messages: Array<{ id: string; content: string; role: 'player' | 'npc' }>;
  readonly isStreaming: boolean;
  inputText: string;

  sendMessage(): Promise<void>;
  setInput(text: string): void;
  handleBackdropClick(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  close(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TalkToPartyViewModel
  extends BaseViewModel<TalkToPartyViewModelOptions>
  implements TalkToPartyViewModelInterface
{
  private readonly _npcId: string;
  private readonly _npcName: string;
  private readonly _npcDialogueService: TalkToPartyDialogueCapabilities;
  private readonly _partyRoster: TalkToPartyRosterCapabilities;
  private readonly _overlays: TalkToPartyOverlayCapabilities;

  messages = $state<Array<{ id: string; content: string; role: 'player' | 'npc' }>>([]);
  isStreaming = $state<boolean>(false);
  inputText = $state<string>('');

  constructor(options: TalkToPartyViewModelOptions) {
    super(options);
    this._npcId = options.npcId;
    this._npcName = options.npcName;
    this._npcDialogueService = options.npcDialogueService;
    this._partyRoster = options.partyRoster;
    this._overlays = options.overlays;

    // Initial greeting from companion
    const member = this._partyRoster.getMember(this._npcId);
    let approvalMsg: string;
    if (member && member.approval > 50) {
      approvalMsg = ' (They seem particularly happy to talk with you.)';
    } else if (member && member.approval < -50) {
      approvalMsg = ' (They eye you warily.)';
    } else {
      approvalMsg = '';
    }

    this.messages = [
      {
        id: crypto.randomUUID(),
        content: `*${this._npcName} turns to you attentively.*${approvalMsg}`,
        role: 'npc',
      },
    ];
  }

  get npcName(): string {
    return this._npcName;
  }

  get npcId(): string {
    return this._npcId;
  }

  get approval(): number {
    return this._partyRoster.getApproval(this._npcId);
  }

  /** @inheritdoc */
  async sendMessage(): Promise<void> {
    const content = this.inputText.trim();
    if (!content || this.isStreaming) {
      return;
    }

    this.inputText = '';

    const playerMessage = {
      id: crypto.randomUUID(),
      content,
      role: 'player' as const,
    };
    this.messages = [...this.messages, playerMessage];

    this.isStreaming = true;

    try {
      const controller = new AbortController();

      const messageList: Array<{ role: 'player' | 'npc'; content: string }> = this.messages.map(
        (m) => ({
          role: m.role,
          content: m.content,
        }),
      );

      const turn = await this._npcDialogueService.generateTurn({
        npcId: this._npcId,
        npcName: this._npcName,
        messages: messageList,
        signal: controller.signal,
      });

      this.messages = [
        ...this.messages,
        {
          id: crypto.randomUUID(),
          content: turn.narrative,
          role: 'npc',
        },
      ];
    } catch (_error) {
      this.messages = [
        ...this.messages,
        {
          id: crypto.randomUUID(),
          content: `*${this._npcName} shrugs — they don't have much to say right now.*`,
          role: 'npc',
        },
      ];
    } finally {
      this.isStreaming = false;
    }
  }

  /** @inheritdoc */
  setInput(text: string): void {
    this.inputText = text;
  }

  /** Closes the overlay when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  /** @inheritdoc */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  /** @inheritdoc */
  close(): void {
    this._overlays.clearStack();
    this._overlays.openPartyRoster();
  }
}

/**
 * Builds a talk-to-party ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getTalkToPartyViewModel` in
 * ./talk_to_party_composition.ts.
 */
export const createTalkToPartyViewModel = (
  options: TalkToPartyViewModelOptions,
): TalkToPartyViewModelInterface => TalkToPartyViewModel.create(options);

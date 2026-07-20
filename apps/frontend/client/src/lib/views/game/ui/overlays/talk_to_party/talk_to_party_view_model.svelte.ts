// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte.ts
//
// Talk to Party overlay ViewModel — companion-specific dialogue when
// initiating conversation with an already-recruited party member.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { NpcDialogueServiceInterface } from '$lib/services/game/npc_dialogue_service.svelte';
import { gameOverlayService, partyRosterService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TalkToPartyViewModelOptions = BaseViewModelOptions & {
  /** The companion's NPC ID. */
  npcId: string;
  /** The companion's display name. */
  npcName: string;
  /** NPC dialogue orchestrator — handles AI streaming and authored fallback. */
  npcDialogueService: NpcDialogueServiceInterface;
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
  messages = $state<Array<{ id: string; content: string; role: 'player' | 'npc' }>>([]);
  isStreaming = $state<boolean>(false);
  inputText = $state<string>('');

  private readonly _npcId: string;
  private readonly _npcName: string;
  private readonly _npcDialogueService: NpcDialogueServiceInterface;

  constructor(options: TalkToPartyViewModelOptions) {
    super(options);
    this._npcId = options.npcId;
    this._npcName = options.npcName;
    this._npcDialogueService = options.npcDialogueService;

    // Initial greeting from companion
    const member = partyRosterService.getMember(this._npcId);
    const approvalMsg =
      member && member.approval > 50
        ? ' (They seem particularly happy to talk with you.)'
        : member && member.approval < -50
          ? ' (They eye you warily.)'
          : '';

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
    return partyRosterService.getApproval(this._npcId);
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
    gameOverlayService.clearStack();
    gameOverlayService.openPartyRoster();
  }
}

export const getTalkToPartyViewModel = (
  options: TalkToPartyViewModelOptions,
): TalkToPartyViewModelInterface => TalkToPartyViewModel.create(options);

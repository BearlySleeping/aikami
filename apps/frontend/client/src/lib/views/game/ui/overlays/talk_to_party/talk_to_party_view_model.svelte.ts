// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte.ts
//
// Talk to Party overlay ViewModel — companion-specific dialogue when
// initiating conversation with an already-recruited party member.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)
// Extended: C-493 Wire group scenes into the production party path (AC-1) —
//   when two or more companions are present, addressing the party routes
//   through the group-turn path (generateMultiNpcResponses) so multiple
//   companions respond in one turn, the second aware of the first.

import { MAX_GROUP_PARTICIPANTS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  type AutonomousMessageServiceInterface,
  autonomousMessageService as defaultAutonomousMessageService,
  gameOverlayService,
  type NpcDialogueServiceInterface,
  partyRosterService,
} from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single chat bubble rendered in the overlay. */
export type TalkMessage = {
  id: string;
  content: string;
  role: 'player' | 'npc';
  /** Optional display name — set for group responders so the UI shows which companion spoke. */
  senderName?: string;
};

/** Narrow group-turn surface the ViewModel depends on (C-493 AC-1). */
type GroupTurnService = Pick<
  AutonomousMessageServiceInterface,
  'selectGroupParticipants' | 'generateMultiNpcResponses'
>;

export type TalkToPartyViewModelOptions = BaseViewModelOptions & {
  /** The companion's NPC ID. */
  npcId: string;
  /** The companion's display name. */
  npcName: string;
  /** NPC dialogue orchestrator — handles AI streaming and authored fallback. */
  npcDialogueService: NpcDialogueServiceInterface;
  /**
   * Group-turn orchestrator (C-493 AC-1). Defaults to the production
   * autonomousMessageService singleton. Injected for testability.
   */
  autonomousMessageService?: GroupTurnService;
};

export type TalkToPartyViewModelInterface = BaseViewModelInterface & {
  readonly npcName: string;
  readonly npcId: string;
  readonly approval: number;
  readonly messages: TalkMessage[];
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
  messages = $state<TalkMessage[]>([]);
  isStreaming = $state<boolean>(false);
  inputText = $state<string>('');

  private readonly _npcId: string;
  private readonly _npcName: string;
  private readonly _npcDialogueService: NpcDialogueServiceInterface;
  private readonly _autonomousMessageService: GroupTurnService;

  constructor(options: TalkToPartyViewModelOptions) {
    super(options);
    this._npcId = options.npcId;
    this._npcName = options.npcName;
    this._npcDialogueService = options.npcDialogueService;
    this._autonomousMessageService =
      options.autonomousMessageService ?? defaultAutonomousMessageService;

    // Initial greeting from companion
    const member = partyRosterService.getMember(this._npcId);
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
      const recentChat = this.messages
        .slice(0, -1)
        .map(
          (m) =>
            `[${m.role === 'player' ? 'player' : (m.senderName ?? this._npcName)}]: ${m.content}`,
        );

      const members = partyRosterService.members;

      // C-493 AC-1: group path when two or more companions are present —
      // select a bounded group and generate sequential responses so the
      // second responder is aware of the first.
      if (members.length >= 2) {
        const otherNpcIds = members
          .map((member) => member.npcId)
          .filter((npcId) => npcId !== this._npcId);
        const selected = [
          this._npcId,
          ...this._autonomousMessageService.selectGroupParticipants({
            npcIds: otherNpcIds,
            count: MAX_GROUP_PARTICIPANTS - 1,
          }),
        ];

        if (selected.length >= 2) {
          const responses = await this._autonomousMessageService.generateMultiNpcResponses({
            npcIds: selected,
            playerMessage: content,
            recentChat,
          });

          const groupReplies: TalkMessage[] = [];
          for (let i = 0; i < responses.length; i++) {
            const response = responses[i];
            const npcId = selected[i];
            if (!response || !npcId) {
              continue;
            }
            groupReplies.push({
              id: crypto.randomUUID(),
              content: response,
              role: 'npc',
              senderName: partyRosterService.getMember(npcId)?.name ?? npcId,
            });
          }

          if (groupReplies.length > 0) {
            this.messages = [...this.messages, ...groupReplies];
            return;
          }
          // Fall through to the single-companion path if the group produced
          // no responses (e.g. all generations failed).
        }
      }

      // Single-companion path — fewer than two companions, or group path
      // produced nothing usable.
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
    gameOverlayService.clearStack();
    gameOverlayService.openPartyRoster();
  }
}

export const getTalkToPartyViewModel = (
  options: TalkToPartyViewModelOptions,
): TalkToPartyViewModelInterface => TalkToPartyViewModel.create(options);

// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { type TextChatMessage, textGenerationService } from '$services';
import type { DialogueNpcData } from '../../game_ui_view_model.svelte';

// ---------------------------------------------------------------------------
// DialogueOverlayViewModel — orchestrates AI chat with an NPC
//
// Manages the conversation history, AI text streaming, and player input
// for the in-game dialogue overlay. Injected with NPC data from the
// GameUIViewModel when the player interacts with an NPC.
//
// Contract: C-128 Dialogue Overlay & AI Chat
// ---------------------------------------------------------------------------

/** A single chat message rendered in the dialogue history. */
export type DialogueMessage = {
  id: string;
  text: string;
  sender: 'player' | 'npc';
};

export type DialogueOverlayViewModelOptions = BaseViewModelOptions & {
  /** NPC data from the ECS interaction event. */
  npcData: DialogueNpcData;
  /** Called when the player ends the conversation. */
  onEndChat: () => void;
};

export type DialogueOverlayViewModelInterface = BaseViewModelInterface & {
  /** The NPC's display name. */
  readonly npcName: string;

  /** Conversation history — player and NPC messages. */
  readonly messages: DialogueMessage[];

  /** Whether the AI is currently generating a response. */
  readonly isAiTyping: boolean;

  /** The player's current input text (bound to the text input field). */
  readonly currentInput: string;

  /** Error message from the last failed generation, if any. */
  readonly errorMessage: string | undefined;

  /**
   * Sends the current input as a player message and triggers AI response.
   * Does nothing if input is empty or AI is already typing.
   */
  sendMessage(): Promise<void>;

  /** Sets the player's input text (bound to text input field). */
  setInput(text: string): void;

  /** Closes the dialogue overlay and resumes the game. */
  endChat(): void;

  /**
   * Handles keydown events on the text input.
   * Enter submits the message; Escape ends the chat.
   */
  handleKeyDown(event: KeyboardEvent): void;
};

class DialogueOverlayViewModel
  extends BaseViewModel<DialogueOverlayViewModelOptions>
  implements DialogueOverlayViewModelInterface
{
  messages = $state<DialogueMessage[]>([]);

  isAiTyping = $state<boolean>(false);

  currentInput = $state<string>('');

  errorMessage = $state<string | undefined>(undefined);

  private readonly _npcData: DialogueNpcData;

  private readonly _onEndChat: () => void;

  constructor(options: DialogueOverlayViewModelOptions) {
    super(options);
    this._npcData = options.npcData;
    this._onEndChat = options.onEndChat;
  }

  get npcName(): string {
    return this._npcData.npcName;
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Show the NPC's initial greeting dialog as the first message
    if (this._npcData.dialog) {
      this.messages = [
        {
          id: crypto.randomUUID(),
          text: this._npcData.dialog,
          sender: 'npc',
        },
      ];
    }

    await super.initialize();
  }

  /** @inheritdoc */
  setInput(text: string): void {
    this.currentInput = text;
  }

  /** @inheritdoc */
  async sendMessage(): Promise<void> {
    const text = this.currentInput.trim();
    if (!text || this.isAiTyping) {
      return;
    }

    // Clear input immediately so the player sees feedback
    this.currentInput = '';
    this.errorMessage = undefined;

    // Append the player's message
    const playerMessage: DialogueMessage = {
      id: crypto.randomUUID(),
      text,
      sender: 'player',
    };
    this.messages = [...this.messages, playerMessage];

    // Generate AI response
    await this._generateAiResponse();
  }

  /** @inheritdoc */
  endChat(): void {
    this._onEndChat();
  }

  /** @inheritdoc */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.endChat();
    }
  }

  // ── Private: AI response generation ──────────────────────────────────

  /**
   * Builds the system prompt that defines the NPC's personality and
   * response style. Uses the NPC name and greeting for context.
   */
  private _buildSystemPrompt(): string {
    const { npcName, dialog } = this._npcData;

    const lines = [
      `You are ${npcName}, a character in a fantasy game world.`,
      `Stay in character at all times. Respond as ${npcName} would.`,
    ];

    if (dialog) {
      lines.push(`Your initial greeting was: "${dialog}"`);
    }

    lines.push(
      'Keep responses concise — 1 to 3 sentences. Be immersive and natural.',
      'Do not break character. Do not mention being an AI.',
    );

    return lines.join('\n');
  }

  /**
   * Sends the conversation history to the AI text generation service and
   * streams the response token by token into the last message.
   */
  private async _generateAiResponse(): Promise<void> {
    this.isAiTyping = true;
    this.errorMessage = undefined;

    // Create a placeholder NPC message that will accumulate streamed tokens
    const npcMessageId = crypto.randomUUID();
    this.messages = [
      ...this.messages,
      {
        id: npcMessageId,
        text: '',
        sender: 'npc',
      },
    ];

    try {
      // Build the full message array for the LLM
      const llmMessages: TextChatMessage[] = [
        { role: 'system', content: this._buildSystemPrompt() },
        ...this.messages
          .filter((m) => m.id !== npcMessageId) // exclude empty placeholder
          .map((m) => ({
            role: m.sender === 'player' ? ('user' as const) : ('assistant' as const),
            content: m.text,
          })),
      ];

      let accumulated = '';

      await textGenerationService.streamChat({
        messages: llmMessages,
        onChunk: (text: string) => {
          accumulated += text;
          // Mutate the last message in-place for smooth streaming
          this.messages = this.messages.map((m) =>
            m.id === npcMessageId ? { ...m, text: accumulated } : m,
          );
        },
      });

      // Ensure the final accumulated text is set (in case onChunk was never called)
      if (accumulated) {
        this.messages = this.messages.map((m) =>
          m.id === npcMessageId ? { ...m, text: accumulated } : m,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage = message;

      // Replace the empty NPC message with an error placeholder
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, text: '*...*' } : m,
      );
    } finally {
      this.isAiTyping = false;
    }
  }
}

export { DialogueOverlayViewModel };

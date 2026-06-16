// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts

import type { OllamaClient } from '@aikami/frontend/api-core';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  SentenceBoundaryChunker,
  type TextChatMessage,
  textGenerationService,
  ttsService,
} from '$services';
import type { DialogueNpcData } from '../../game_ui_view_model.svelte';

// ── LPC fallback constants ────────────────────────────────────────────

/** Default LPC spritesheet URL used as fallback NPC avatar when image generation is disabled. */
const FALLBACK_AVATAR_URL = '/lpc/body/male/walk.png' as const;

// ── Persona prompt templates ───────────────────────────────────────

/** Known NPC persona archetypes with their role-playing descriptions. */
const PERSONA_PROMPTS: Record<string, string> = {
  default: 'You are a helpful and knowledgeable non-player character in a fantasy world.',
  blacksmith:
    'You are an old, grumpy blacksmith who has worked the forge for forty years. You speak in short, gruff sentences and complain about your aching back. You take pride in your craft but are suspicious of strangers.',
  innkeeper:
    'You are a warm, gossipy innkeeper who knows everyone in town. You love sharing rumors and making travelers feel welcome. You speak in a friendly, chatty manner and often offer unsolicited advice.',
  guard:
    'You are a disciplined town guard who takes your duty seriously. You speak formally and are suspicious of troublemakers. You follow orders but have a hidden soft spot for honest folk.',
  merchant:
    'You are a charismatic traveling merchant always looking for a good deal. You speak enthusiastically about your wares and use flowery language. Everything is "the finest in the land" according to you.',
  sage: 'You are a wise, ancient sage who speaks in riddles and cryptic warnings. You know secrets about the world but reveal them only to those who prove worthy. Your speech is measured and mysterious.',
  bandit:
    'You are a rough-edged bandit hiding in the hills. You speak with a coarse accent and make veiled threats. Deep down you have a code of honor, but you would never admit it.',
  healer:
    'You are a gentle, compassionate healer dedicated to helping the injured and sick. You speak softly and always put others before yourself. You have a deep knowledge of herbs and medicine.',
  guild_master:
    'You are a shrewd guild master who runs the local trade organization with an iron fist. You speak in calculated terms and weigh every word. You are always looking to expand your influence.',
} as const;

const FALLBACK_PERSONA_ID = 'default' as const;

// ---------------------------------------------------------------------------
// DialogueOverlayViewModel — orchestrates AI chat with an NPC
//
// Manages the conversation history, AI text streaming, and player input
// for the in-game dialogue overlay. Injected with NPC data from the
// GameUIViewModel when the player interacts with an NPC.
//
// Supports two streaming backends:
// 1. OllamaClient.streamChat() — direct local streaming via Ollama's /api/generate
// 2. textGenerationService.streamChat() — OpenRouter cloud streaming fallback
//
// Contract: C-128 (origin), C-129 (polish)
// ---------------------------------------------------------------------------

/** A single chat message rendered in the dialogue history. */
export type DialogueMessage = {
  /** Unique identifier for the message (used as Svelte {#each} key). */
  id: string;
  /** The role of the speaker. */
  role: 'player' | 'npc';
  /** The message content text. */
  content: string;
};

export type DialogueOverlayViewModelOptions = BaseViewModelOptions & {
  /** NPC data from the ECS interaction event. */
  npcData: DialogueNpcData;
  /** Called when the player ends the conversation. */
  onEndChat: () => void;
  /**
   * Optional OllamaClient instance for direct local streaming.
   * When provided, streamChat() uses Ollama's /api/generate directly
   * instead of routing through textGenerationService (OpenRouter).
   */
  ollamaClient?: OllamaClient;
  /**
   * Whether image generation (ComfyUI or Cloud) is available.
   * When false, ComfyUI requests are skipped and fallback NPC
   * avatars from lpc_asset_catalog are displayed instead.
   *
   * Defaults to true for backwards compatibility.
   */
  imageProviderAvailable?: boolean;
};

export type DialogueOverlayViewModelInterface = BaseViewModelInterface & {
  /** The NPC's display name. */
  readonly npcName: string;

  /** URL for the NPC's avatar image (LPC spritesheet or generated portrait). */
  readonly npcAvatarUrl: string;

  /** Whether the image generation provider is available. */
  readonly imageProviderAvailable: boolean;

  /** Conversation history — player and NPC messages. */
  readonly messages: DialogueMessage[];

  /** Whether the AI is currently streaming a response. */
  readonly isStreaming: boolean;

  /** The player's current input text (bound to the text input field). */
  readonly inputText: string;

  /** Error message from the last failed generation, if any. */
  readonly streamError: string | null;

  /**
   * Sends the given text (or current input) as a player message
   * and triggers AI response streaming. Does nothing if input is
   * empty or AI is already streaming.
   *
   * @param text — Optional explicit text to send. Falls back to current inputText.
   */
  sendMessage(text?: string): Promise<void>;

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

  isStreaming = $state<boolean>(false);

  inputText = $state<string>('');

  streamError = $state<string | null>(null);

  private readonly _npcData: DialogueNpcData;

  private readonly _onEndChat: () => void;

  private readonly _ollamaClient?: OllamaClient;

  private readonly _imageProviderAvailable: boolean;

  private readonly _chunker = new SentenceBoundaryChunker();

  private _ttsInitialized = false;

  constructor(options: DialogueOverlayViewModelOptions) {
    super(options);
    this._npcData = options.npcData;
    this._onEndChat = options.onEndChat;
    this._ollamaClient = options.ollamaClient;
    this._imageProviderAvailable = options.imageProviderAvailable ?? true;

    // Show the NPC's initial greeting dialog as the first message.
    // Done in constructor (not initialize) because the consumer may
    // not wrap with BaseViewModelContainer.
    if (this._npcData.dialog) {
      this.messages = [
        {
          id: crypto.randomUUID(),
          content: this._npcData.dialog,
          role: 'npc' as const,
        },
      ];
    }
  }

  get npcName(): string {
    return this._npcData.npcName;
  }

  /**
   * NPC avatar URL.
   * Uses the fallback LPC spritesheet from the asset catalog when image
   * generation is unavailable, or the default body walk sheet otherwise.
   */
  get npcAvatarUrl(): string {
    return FALLBACK_AVATAR_URL;
  }

  /** @inheritdoc */
  get imageProviderAvailable(): boolean {
    return this._imageProviderAvailable;
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    // Initialize native Kokoro TTS if not already done
    if (!this._ttsInitialized) {
      this._ttsInitialized = true;
      this._chunker.onSentence(({ sentence }) => {
        ttsService.synthesize({
          text: sentence,
          voice: ttsService.selectedVoice,
        });
      });

      // Fire-and-forget — TTS init happens in background, speech works
      // once the worker reports 'ready'.
      void ttsService.initialize();
    }

    await super.initialize();
  }

  /** @inheritdoc */
  setInput(text: string): void {
    this.inputText = text;
  }

  /** @inheritdoc */
  async sendMessage(text?: string): Promise<void> {
    const content = (text ?? this.inputText).trim();
    if (!content || this.isStreaming) {
      return;
    }

    // Clear input immediately so the player sees feedback
    this.inputText = '';
    this.streamError = null;

    // Append the player's message
    const playerMessage: DialogueMessage = {
      id: crypto.randomUUID(),
      content,
      role: 'player',
    };
    this.messages = [...this.messages, playerMessage];

    // Generate AI response via appropriate backend
    await this._generateAiResponse();
  }

  /** @inheritdoc */
  endChat(): void {
    // Flush any remaining buffered text as a final sentence
    this._chunker.close();
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
    const { npcName, dialog, personaId } = this._npcData;

    // Start with the persona-specific archetype description
    const personaPrompt =
      PERSONA_PROMPTS[personaId ?? FALLBACK_PERSONA_ID] ?? PERSONA_PROMPTS[FALLBACK_PERSONA_ID];

    const lines = [
      personaPrompt,
      `Your name is ${npcName}.`,
      `Stay in character at all times. Respond as ${npcName} would.`,
    ];

    if (dialog) {
      lines.push(`Your initial greeting to the player was: "${dialog}"`);
    }

    lines.push(
      'Keep responses concise — 1 to 3 sentences. Be immersive and natural.',
      'Do not break character. Do not mention being an AI.',
    );

    return lines.join('\n');
  }

  /**
   * Sends the conversation history to the AI and streams the response
   * token by token into the last message.
   *
   * When an OllamaClient is available, uses direct /api/generate streaming.
   * Falls back to textGenerationService (OpenRouter SSE) otherwise.
   *
   * Image generation (ComfyUI) requests are skipped entirely when
   * imageProviderAvailable is false — see C-133 graceful degradation.
   */
  private async _generateAiResponse(): Promise<void> {
    this.isStreaming = true;
    this.streamError = null;

    // Create a placeholder NPC message that accumulates streamed tokens
    const npcMessageId = crypto.randomUUID();
    this.messages = [
      ...this.messages,
      {
        id: npcMessageId,
        content: '',
        role: 'npc' as const,
      },
    ];

    try {
      if (this._ollamaClient) {
        await this._streamViaOllama({ npcMessageId });
      } else {
        await this._streamViaTextGenerationService({ npcMessageId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.streamError = message;

      // Replace the empty NPC message with an error placeholder
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: '*...*' } : m,
      );
    } finally {
      this.isStreaming = false;
    }
  }

  /**
   * Streams NPC response directly from Ollama's /api/generate endpoint.
   * Formats the conversation into a prompt string for Ollama's completion API.
   */
  private async _streamViaOllama(options: { npcMessageId: string }): Promise<void> {
    const { npcMessageId } = options;

    const systemPrompt = this._buildSystemPrompt();

    // Build context array for Ollama's generate endpoint
    const context: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...this.messages
        .filter((m) => m.id !== npcMessageId)
        .map((m) => ({
          role: m.role === 'player' ? 'user' : 'assistant',
          content: m.content,
        })),
    ];

    // Build a plain-text prompt from the context for Ollama's generate API
    const prompt = `${context
      .filter((c) => c.content.trim().length > 0)
      .map(
        (c) =>
          `${c.role === 'system' ? 'System' : c.role === 'user' ? 'Player' : this._npcData.npcName}: ${c.content}`,
      )
      .join('\n')}\n${this._npcData.npcName}:`;

    let accumulated = '';

    const client = this._ollamaClient;
    if (!client) {
      return; // Should not happen — caller checks this._ollamaClient
    }
    const stream = client.streamChat(prompt);

    for await (const chunk of stream) {
      accumulated += chunk;
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: accumulated } : m,
      );
      this._chunker.feed(chunk);
    }

    // Flush any remaining text at end of stream
    this._chunker.close();

    // Ensure final text is set (in case stream yielded nothing)
    if (accumulated) {
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: accumulated } : m,
      );
    }
  }

  /**
   * Streams NPC response via textGenerationService (OpenRouter SSE).
   * Used as fallback when no OllamaClient is available.
   */
  private async _streamViaTextGenerationService(options: { npcMessageId: string }): Promise<void> {
    const { npcMessageId } = options;

    const llmMessages: TextChatMessage[] = [
      { role: 'system', content: this._buildSystemPrompt() },
      ...this.messages
        .filter((m) => m.id !== npcMessageId) // exclude empty placeholder
        .map((m) => ({
          role: m.role === 'player' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
    ];

    let accumulated = '';

    await textGenerationService.streamChat({
      messages: llmMessages,
      onChunk: (text: string) => {
        accumulated += text;
        this.messages = this.messages.map((m) =>
          m.id === npcMessageId ? { ...m, content: accumulated } : m,
        );
        this._chunker.feed(text);
      },
    });

    // Flush any remaining text at end of stream
    this._chunker.close();

    if (accumulated) {
      this.messages = this.messages.map((m) =>
        m.id === npcMessageId ? { ...m, content: accumulated } : m,
      );
    }
  }
}

export { DialogueOverlayViewModel };

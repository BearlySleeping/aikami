// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts

import type { OllamaClient } from '@aikami/frontend/api-core';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  diceService,
  SentenceBoundaryChunker,
  type TextChatMessage,
  textGenerationService,
  ttsService,
} from '$services';
import {
  DIALOG_ACTION_SYSTEM_PROMPT,
  type DialogActionIntent,
  DialogActionSchema,
} from '../../../../../game/core/ai/prompts/dialog_action_schema.ts';
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
  /**
   * Called when a state mutation triggers combat from dialogue.
   * The parent (GameUIViewModel) transitions to the COMBAT overlay
   * and creates a CombatViewModel for the NPC.
   *
   * Contract: C-157 Dialogue Skill Checks
   */
  onStartCombat?: (npcData: DialogueNpcData) => void;
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
   * Skill check UI state for the animated d20 component.
   * `null` when no skill check is in progress or recently completed.
   *
   * Contract: C-157 Dialogue Skill Checks
   */
  readonly skillCheckState: {
    readonly checkType: string;
    readonly difficultyClass: number;
    readonly rollValue: number | null;
    readonly isRolling: boolean;
    readonly isSuccess: boolean | null;
  } | null;

  /** Whether the AI is resolving a structured skill check (disables all inputs). */
  readonly isResolvingSkillCheck: boolean;

  /**
   * Screen-space X coordinate of the active dialogue NPC (CSS pixels).
   * Updated reactively from CAMERA_ZOOM_UPDATE bridge events.
   *
   * Contract: C-161 Spatial UI Camera
   */
  npcScreenX: number;

  /**
   * Screen-space Y coordinate of the active dialogue NPC (CSS pixels).
   * Updated reactively from CAMERA_ZOOM_UPDATE bridge events.
   *
   * Contract: C-161 Spatial UI Camera
   */
  npcScreenY: number;

  /**
   * Whether the NPC screen position is available for speech bubble
   * positioning. `true` when dialogue zoom is active and the worker
   * is sending CAMERA_ZOOM_UPDATE events.
   */
  hasNpcScreenPosition: boolean;

  /**
   * Sends the given text (or current input) as a player message
   * and triggers AI response streaming. Does nothing if input is
   * empty or AI is already streaming.
   *
   * For risky actions (threats, theft, persuasion attempts), uses
   * structured extraction to detect skill checks and state mutations.
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

  /**
   * Skill check dice roll UI state — null when idle.
   * Contract: C-157 Dialogue Skill Checks
   */
  skillCheckState: {
    checkType: string;
    difficultyClass: number;
    rollValue: number | null;
    isRolling: boolean;
    isSuccess: boolean | null;
  } | null = $state(null);

  /** Whether the AI is resolving a structured skill check. */
  isResolvingSkillCheck = $state(false);

  /** @inheritdoc */
  npcScreenX = $state<number>(0);

  /** @inheritdoc */
  npcScreenY = $state<number>(0);

  /** @inheritdoc */
  hasNpcScreenPosition = $state<boolean>(false);

  private readonly _npcData: DialogueNpcData;

  private readonly _onEndChat: () => void;

  private readonly _onStartCombat?: (npcData: DialogueNpcData) => void;

  private readonly _ollamaClient?: OllamaClient;

  private readonly _imageProviderAvailable: boolean;

  private readonly _chunker = new SentenceBoundaryChunker();

  private _ttsInitialized = false;

  constructor(options: DialogueOverlayViewModelOptions) {
    super(options);
    this._npcData = options.npcData;
    this._onEndChat = options.onEndChat;
    this._onStartCombat = options.onStartCombat;
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
    if (!content || this.isStreaming || this.isResolvingSkillCheck) {
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

    // Detect risky actions for structured skill check extraction.
    // Casual conversation uses the standard streaming path.
    if (this._isRiskyAction(content)) {
      await this._executeStructuredIntent({ playerContent: content });
    } else {
      // Generate AI response via appropriate backend (existing flow)
      await this._generateAiResponse();
    }
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

  // ── Private: Skill Check Flow (C-157) ───────────────────────────────

  /**
   * Keyword-based detection of risky player actions that may require
   * a skill check (Persuasion, Intimidation, Sleight of Hand).
   *
   * Casual conversation passes through normal streaming; risky actions
   * are routed through structured extraction for skill check detection.
   */
  private _isRiskyAction(content: string): boolean {
    const riskyPatterns = [
      /\b(threaten|intimidate|scare|warn|bully)\b/i,
      /\b(steal|pickpocket|palm|swipe|snatch|slip|grab)\b/i,
      /\b(persuade|convince|charm|bribe|negotiate|haggle|bargain)\b/i,
      /\b(lie|deceive|bluff|trick|mislead)\b/i,
      /\b(attack|punch|stab|shove|tackle|draw .* sword|draw .* weapon)\b/i,
      /\b(force|demand|order|command)\b/i,
    ];

    return riskyPatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Executes the structured skill check flow for a risky player action.
   *
   * 1. Extracts structured intent via the LLM (DialogActionSchema).
   * 2. If a skill check is required, performs the d20 roll with animation.
   * 3. Feeds the roll result back to the LLM for narrative resolution.
   * 4. Handles any state mutations (trigger_combat, give_item).
   *
   * On failure, falls back to streaming chat with an error message.
   */
  private async _executeStructuredIntent(options: { playerContent: string }): Promise<void> {
    const { playerContent } = options;
    this.isResolvingSkillCheck = true;
    this.streamError = null;

    try {
      // Build the conversation context for the LLM
      const conversationContext = this.messages
        .filter((m) => m.content.trim().length > 0)
        .slice(0, -1) // exclude the just-added player message
        .map((m) =>
          m.role === 'player' ? `Player: ${m.content}` : `${this._npcData.npcName}: ${m.content}`,
        )
        .join('\n');

      const contextualPrompt = [
        `NPC Name: ${this._npcData.npcName}`,
        `NPC Personality: ${PERSONA_PROMPTS[this._npcData.personaId ?? FALLBACK_PERSONA_ID]}`,
        conversationContext ? `\nConversation history:\n${conversationContext}` : '',
        `\nPlayer's latest action: "${playerContent}"`,
      ]
        .filter(Boolean)
        .join('\n');

      this.debug('_executeStructuredIntent:calling-extractStructure', {
        playerContent: playerContent.slice(0, 60),
        contextLength: contextualPrompt.length,
      });

      const intent = (await textGenerationService.extractStructure({
        schema: DialogActionSchema as unknown as Record<string, unknown>,
        schemaName: 'DialogActionIntent',
        prompt: contextualPrompt,
        systemPrompt: DIALOG_ACTION_SYSTEM_PROMPT,
      })) as DialogActionIntent;

      this.debug('_executeStructuredIntent:LLM-response', {
        hasCheck: !!intent.requiredCheck,
        checkType: intent.requiredCheck,
        dc: intent.difficultyClass,
        stateMutation: intent.stateMutation,
        itemId: intent.itemId,
        narrativeLength: intent.narrative.length,
      });

      // Always show the NPC's initial reaction narrative
      this._appendNpcMessage(intent.narrative);

      // If a skill check is required, perform the d20 roll
      if (intent.requiredCheck && intent.difficultyClass !== undefined) {
        await this._performSkillCheck({
          checkType: intent.requiredCheck,
          difficultyClass: intent.difficultyClass,
        });

        // Feed the roll result back to the LLM for final resolution
        await this._resolveSkillCheck({
          checkType: intent.requiredCheck,
          difficultyClass: intent.difficultyClass,
          playerContent,
          intent,
        });

        // Keep the dice result visible briefly then clear
        await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        this.skillCheckState = null;
      }

      // Handle state mutations after resolution
      await this._handleStateMutation({ intent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn('_executeStructuredIntent:failed', { message });
      this.streamError = `Skill check failed: ${message}`;
    } finally {
      this.isResolvingSkillCheck = false;
    }
  }

  /**
   * Performs the d20 skill check with animated dice UI.
   *
   * Rolls a d20 using the diceService, shows the rolling animation
   * for ~1.5 seconds, then reveals the result (success or failure).
   *
   * The result is stored in {@link skillCheckState} for the View to render.
   */
  private async _performSkillCheck(options: {
    checkType: string;
    difficultyClass: number;
  }): Promise<{ rollValue: number; isSuccess: boolean }> {
    const { checkType, difficultyClass } = options;

    // Roll the d20
    const { natural: rollValue, total } = diceService.rollD20(0);
    const isSuccess = total >= difficultyClass;

    this.debug('_performSkillCheck', { checkType, difficultyClass, rollValue, total, isSuccess });

    // Show the rolling animation
    this.skillCheckState = {
      checkType,
      difficultyClass,
      rollValue: null,
      isRolling: true,
      isSuccess: null,
    };

    // Wait for the dice animation (~1.5s)
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));

    // Reveal the result — state stays visible for _resolveSkillCheck to read
    this.skillCheckState = {
      checkType,
      difficultyClass,
      rollValue,
      isRolling: false,
      isSuccess,
    };

    return { rollValue, isSuccess };
  }

  /**
   * Feeds the d20 roll result back to the LLM for narrative resolution.
   *
   * The LLM is told whether the skill check passed or failed and
   * provides a narrative resolution — success or failure dialogue
   * from the NPC.
   */
  private async _resolveSkillCheck(options: {
    checkType: string;
    difficultyClass: number;
    playerContent: string;
    intent: DialogActionIntent;
  }): Promise<void> {
    const { checkType, difficultyClass, playerContent, intent } = options;
    const skillCheckState = this.skillCheckState;
    if (!skillCheckState || skillCheckState.rollValue === null) {
      return;
    }

    const { rollValue, isSuccess } = skillCheckState;

    const resolutionPrompt = [
      `The player attempted: "${playerContent}"`,
      `Skill check: ${checkType} (DC ${difficultyClass})`,
      `Result: Rolled ${rollValue} — ${isSuccess ? 'SUCCESS' : 'FAILURE'}`,
      `\nThe NPC's initial reaction was: "${intent.narrative}"`,
      `\nNow provide the NPC's final response to the ${isSuccess ? 'SUCCESSFUL' : 'FAILED'} skill check.`,
      isSuccess
        ? 'The player succeeded — the NPC should react accordingly (give information, hand over the item, show fear, etc.).'
        : 'The player failed — the NPC should react accordingly (get angry, refuse, raise alarm, mock the attempt).',
      `\nRespond as ${this._npcData.npcName} in 1–3 sentences. Stay in character.`,
    ].join('\n');

    this.debug('_resolveSkillCheck:sending', {
      checkType,
      rollValue,
      isSuccess,
      promptLength: resolutionPrompt.length,
    });

    try {
      const messages: TextChatMessage[] = [
        { role: 'system', content: this._buildSystemPrompt() },
        { role: 'user', content: resolutionPrompt },
      ];

      if (this._ollamaClient) {
        // Ollama direct streaming
        const prompt = `System: ${this._buildSystemPrompt()}\nUser: ${resolutionPrompt}\n${this._npcData.npcName}:`;
        let accumulated = '';
        const npcMessageId = crypto.randomUUID();
        this.messages = [...this.messages, { id: npcMessageId, content: '', role: 'npc' as const }];

        const client = this._ollamaClient;
        if (!client) {
          return;
        }
        const stream = client.streamChat(prompt);

        for await (const chunk of stream) {
          accumulated += chunk;
          this.messages = this.messages.map((m) =>
            m.id === npcMessageId ? { ...m, content: accumulated } : m,
          );
          this._chunker.feed(chunk);
        }
        this._chunker.close();
      } else {
        // OpenRouter streaming
        const npcMessageId = crypto.randomUUID();
        this.messages = [...this.messages, { id: npcMessageId, content: '', role: 'npc' as const }];

        let accumulated = '';
        await textGenerationService.streamChat({
          messages,
          onChunk: (text: string) => {
            accumulated += text;
            this.messages = this.messages.map((m) =>
              m.id === npcMessageId ? { ...m, content: accumulated } : m,
            );
            this._chunker.feed(text);
          },
        });
        this._chunker.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn('_resolveSkillCheck:failed', { message });
      this._appendNpcMessage(isSuccess ? '*The attempt succeeded.*' : '*The attempt failed.*');
    }
  }

  /**
   * Handles state mutations returned by the LLM.
   *
   * - `trigger_combat`: Closes the dialogue and notifies the parent
   *   to transition to the COMBAT overlay against the current NPC.
   * - `give_item`: Appends a narrative message confirming the item.
   *
   * Item granting is a narrative note for MVP — actual inventory
   * mutations are future work.
   */
  private async _handleStateMutation(options: { intent: DialogActionIntent }): Promise<void> {
    const { intent } = options;

    if (intent.stateMutation === 'trigger_combat') {
      this.debug('_handleStateMutation:trigger_combat', {
        npcName: this._npcData.npcName,
        npcId: this._npcData.npcId,
      });

      // Append a combat transition message
      this._appendNpcMessage(`*${this._npcData.npcName} reaches for a weapon — combat begins!*`);

      // Brief delay so the player can read the transition message
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));

      // End the dialogue
      this._onEndChat();

      // Notify parent to start combat
      if (this._onStartCombat) {
        this._onStartCombat(this._npcData);
      }

      return;
    }

    if (intent.stateMutation === 'give_item' && intent.itemId) {
      this.debug('_handleStateMutation:give_item', { itemId: intent.itemId });
      this._appendNpcMessage(`*Received: ${intent.itemId}*`);
    }
  }

  /**
   * Appends an NPC message to the conversation history.
   */
  private _appendNpcMessage(content: string): void {
    this.messages = [
      ...this.messages,
      {
        id: crypto.randomUUID(),
        content,
        role: 'npc' as const,
      },
    ];
  }
}

export { DialogueOverlayViewModel };

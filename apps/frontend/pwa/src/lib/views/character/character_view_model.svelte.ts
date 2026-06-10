// apps/frontend/pwa/src/lib/views/character/character_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import {
  CHARACTER_EXTRACTION_SYSTEM_PROMPT,
  CharacterExtractionSchema,
} from '$lib/game/core/ai/prompts/character_extraction_schema';
import { DND_CREATION_SYSTEM_PROMPT } from '$lib/game/core/ai/prompts/dnd_creation';
import { aiSettingsService, aiTextIntelligenceService, characterCreationService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The character creation phase. */
export type CreationPhase = 'CHAT' | 'GENERATING' | 'TWEAK';

/** A single message in the DM chat history. */
export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

/** Label for an ability score stat display. */
export type ScoreLabel = {
  readonly key: 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
  readonly label: string;
  readonly desc: string;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type CharacterViewModelInterface = BaseViewModelInterface & {
  readonly phase: CreationPhase;
  readonly messages: readonly ChatMessage[];
  readonly persona: PersonaData | undefined;
  readonly avatarUrl: string;
  readonly isStreaming: boolean;
  readonly chatInput: string;
  readonly debugOpen: boolean;
  readonly scoreLabels: readonly ScoreLabel[];

  sendChatMessage(text: string): Promise<void>;
  generateCharacter(): Promise<void>;
  cancel(): void;
  handleSend(): Promise<void>;
  handleKeydown(event: KeyboardEvent): void;
  incrementStat(statKey: ScoreLabel['key']): void;
  decrementStat(statKey: ScoreLabel['key']): void;
  updateAppearanceDescription(value: string): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type CharacterViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CharacterViewModel
  extends BaseViewModel<CharacterViewModelOptions>
  implements CharacterViewModelInterface
{
  phase: CreationPhase = $state('CHAT');
  messages: ChatMessage[] = $state([]);
  chatInput = $state('');
  debugOpen = $state(false);

  private static readonly _SCORE_LABELS: readonly ScoreLabel[] = [
    { key: 'strength', label: 'STR', desc: 'Strength' },
    { key: 'dexterity', label: 'DEX', desc: 'Dexterity' },
    { key: 'constitution', label: 'CON', desc: 'Constitution' },
    { key: 'intelligence', label: 'INT', desc: 'Intelligence' },
    { key: 'wisdom', label: 'WIS', desc: 'Wisdom' },
    { key: 'charisma', label: 'CHA', desc: 'Charisma' },
  ] as const;

  get persona(): PersonaData | undefined {
    return characterCreationService.persona;
  }

  get avatarUrl(): string {
    return characterCreationService.avatarUrl;
  }

  get isStreaming(): boolean {
    return characterCreationService.isStreaming;
  }

  get scoreLabels(): readonly ScoreLabel[] {
    return CharacterViewModel._SCORE_LABELS;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    const model = (import.meta.env.PUBLIC_OPENROUTER_MODEL as string) || undefined;

    if (model) {
      aiSettingsService.setTextProvider({ model });
    }

    this.messages = [
      {
        role: 'system',
        content: DND_CREATION_SYSTEM_PROMPT,
      },
      {
        role: 'assistant',
        content:
          'Welcome, brave adventurer! I am your Dungeon Master, here to guide you through creating a hero worthy of legend. Tell me — what kind of character do you envision? A cunning rogue, a wise wizard, a stalwart warrior? Describe your concept and we shall forge your destiny together, following the sacred rules of D&D 2024.',
      },
    ];
    await super.initialize();
  }

  // ── Public API ────────────────────────────────────────────────────────

  async sendChatMessage(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }
    this.messages = await characterCreationService.sendMessage({ text, messages: this.messages });
  }

  async handleSend(): Promise<void> {
    const text = this.chatInput.trim();
    if (!text || this.isStreaming) {
      return;
    }
    this.chatInput = '';
    await this.sendChatMessage(text);
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.handleSend();
    }
  }

  async generateCharacter(): Promise<void> {
    this.phase = 'GENERATING';

    const compiledHistory = this._compileChatHistory();

    try {
      const extracted = await aiTextIntelligenceService.extractStructure({
        schema: CharacterExtractionSchema as unknown as Record<string, unknown>,
        schemaName: 'CharacterExtraction',
        prompt: compiledHistory,
        systemPrompt: CHARACTER_EXTRACTION_SYSTEM_PROMPT,
      });

      if (extracted) {
        characterCreationService.persona = extracted as unknown as PersonaData;

        const persona = characterCreationService.persona;
        const imagePrompt =
          persona?.appearance?.physicalDescription || persona?.name || 'fantasy character';
        characterCreationService.startAvatarGeneration({ prompt: imagePrompt });
        this.phase = 'TWEAK';
      } else {
        this.phase = 'CHAT';
        this.errorMessage = 'Failed to generate character. Please try again.';
      }
    } catch (error: unknown) {
      const err = error as Error & { name: string };
      this.error('generateCharacter', err);
      this.phase = 'CHAT';
      if (err.name === 'AbortError') {
        this.errorMessage = 'Character generation was cancelled.';
      } else {
        this.errorMessage = 'Failed to generate character. Please try again.';
      }
    }
  }

  cancel(): void {
    characterCreationService.cancel();
    this.phase = 'CHAT';
  }

  incrementStat(statKey: ScoreLabel['key']): void {
    const scores = this.persona?.abilityScores;
    if (scores && typeof scores[statKey] === 'number' && (scores[statKey] as number) < 30) {
      scores[statKey] = (scores[statKey] as number) + 1;
    }
  }

  decrementStat(statKey: ScoreLabel['key']): void {
    const scores = this.persona?.abilityScores;
    if (scores && typeof scores[statKey] === 'number' && (scores[statKey] as number) > 1) {
      scores[statKey] = (scores[statKey] as number) - 1;
    }
  }

  updateAppearanceDescription(value: string): void {
    if (!this.persona) {
      return;
    }
    if (!this.persona.appearance) {
      this.persona.appearance = {};
    }
    this.persona.appearance.physicalDescription = value;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _compileChatHistory(): string {
    const lines: string[] = [];

    const systemMsg = this.messages.find((m) => m.role === 'system');
    if (systemMsg) {
      lines.push(systemMsg.content);
    } else {
      lines.push(DND_CREATION_SYSTEM_PROMPT);
    }

    lines.push('');
    lines.push('--- Conversation History ---');

    const conversation = this.messages.filter((m) => m.role !== 'system');
    for (const message of conversation) {
      const label = message.role === 'user' ? 'Player' : 'DM';
      lines.push(`${label}: ${message.content}`);
    }

    if (conversation.length === 0) {
      lines.push('Player: (new conversation — greet the player and start character creation)');
    }

    return lines.join('\n');
  }
}

export const getCharacterViewModel = (
  options: CharacterViewModelOptions,
): CharacterViewModelInterface => {
  return new CharacterViewModel(options);
};

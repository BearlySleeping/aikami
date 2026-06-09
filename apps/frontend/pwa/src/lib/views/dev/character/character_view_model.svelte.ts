// apps/frontend/pwa/src/lib/views/dev/character/character_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { DND_CREATION_SYSTEM_PROMPT } from '$lib/client/game/core/ai/prompts/dnd_creation';
import { aiSettingsService, characterCreationService } from '$services';

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

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type CharacterViewModelInterface = BaseViewModelInterface & {
  readonly phase: CreationPhase;
  readonly messages: readonly ChatMessage[];
  readonly persona: PersonaData | undefined;
  readonly avatarUrl: string;
  readonly isStreaming: boolean;

  sendChatMessage(text: string): Promise<void>;
  generateCharacter(): Promise<void>;
  cancel(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type CharacterViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class CharacterViewModel
  extends BaseViewModel<CharacterViewModelOptions>
  implements CharacterViewModelInterface
{
  phase: CreationPhase = $state('CHAT');
  messages: ChatMessage[] = $state([]);

  get persona(): PersonaData | undefined {
    return characterCreationService.persona;
  }

  get avatarUrl(): string {
    return characterCreationService.avatarUrl;
  }

  get isStreaming(): boolean {
    return characterCreationService.isStreaming;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Configure text generation from environment — the server handles the
    // actual API key; we just signal that the external provider is available.
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

  async generateCharacter(): Promise<void> {
    this.phase = 'GENERATING';

    const compiledHistory = this._compileChatHistory();

    try {
      const persona = await characterCreationService.generatePersona({ history: compiledHistory });
      if (persona) {
        const imagePrompt =
          persona.appearance?.physicalDescription ?? persona.name ?? 'fantasy character';
        characterCreationService.startAvatarGeneration({ prompt: imagePrompt });
        this.phase = 'TWEAK';
      } else {
        this.phase = 'CHAT';
        this.errorMessage = 'Failed to generate character. Please try again.';
      }
    } catch (error) {
      this.error('generateCharacter', error);
      this.phase = 'CHAT';
      this.errorMessage = 'Failed to generate character. Please try again.';
    }
  }

  cancel(): void {
    characterCreationService.cancel();
    this.phase = 'CHAT';
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
): CharacterViewModelInterface => new CharacterViewModel(options);

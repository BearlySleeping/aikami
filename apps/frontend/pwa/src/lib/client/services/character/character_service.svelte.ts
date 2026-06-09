// apps/frontend/pwa/src/lib/client/services/character/character_service.svelte.ts
//
// Character creation service — orchestrates the character creation flow:
// 1. DM chat via characterTextStreamService
// 2. Persona extraction via aiService.createPersona()
// 3. Avatar generation via imageGenerationService.generateImage()

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { aiService, imageGenerationService } from '$services';
import { characterTextStreamService } from './character_text_stream.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type CharacterCreationServiceInterface = BaseFrontendClassInterface & {
  /** The extracted persona data. */
  persona: PersonaData | undefined;
  /** The generated avatar URL. */
  avatarUrl: string;
  /** Whether the DM is currently streaming a response. */
  readonly isStreaming: boolean;

  /** Sends a chat message and receives a DM response via SSE. */
  sendMessage(options: { text: string; messages: ChatMessage[] }): Promise<ChatMessage[]>;
  /** Generates a persona from the chat history and starts avatar generation. */
  generatePersona(options: { history: string }): Promise<PersonaData | undefined>;
  /** Starts avatar generation in the background. */
  startAvatarGeneration(options: { prompt: string }): void;
  /** Cancels the active stream. */
  cancel(): void;
};

export type CharacterCreationServiceOptions = BaseFrontendClassOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class CharacterCreationService
  extends BaseFrontendClass<CharacterCreationServiceOptions>
  implements CharacterCreationServiceInterface
{
  persona: PersonaData | undefined = $state(undefined);
  avatarUrl = $state('');

  get isStreaming(): boolean {
    return characterTextStreamService.isGenerating;
  }

  // ── Public API ────────────────────────────────────────────────────────

  async sendMessage(options: { text: string; messages: ChatMessage[] }): Promise<ChatMessage[]> {
    const { text, messages } = options;
    const trimmed = text.trim();
    if (!trimmed) {
      return messages;
    }

    const updated: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    const compiledPrompt = this._compilePrompt(updated);

    this.info('sendMessage:start', {
      text: trimmed,
      messageCount: messages.length,
      promptLength: compiledPrompt.length,
    });

    try {
      await characterTextStreamService.generate({ prompt: compiledPrompt });
      const response = characterTextStreamService.output;
      if (response) {
        this.info('sendMessage:response', { responseLength: response.length });
        return [...updated, { role: 'assistant', content: response }];
      }
      this.warn('sendMessage:empty-response');
    } catch (error) {
      this.error('sendMessage:failed', error);
    }

    return updated;
  }

  async generatePersona(options: { history: string }): Promise<PersonaData | undefined> {
    this.info('generatePersona:start', { historyLength: options.history.length });

    try {
      const persona = await aiService.createPersona(options.history);
      if (persona) {
        this.info('generatePersona:done', {
          name: persona.name,
          hasAppearance: !!persona.appearance?.physicalDescription,
          hasAbilityScores: !!persona.abilityScores,
        });
        this.persona = persona;
      } else {
        this.warn('generatePersona:no-result');
      }
      return persona;
    } catch (error) {
      this.error('generatePersona:failed', error);
      return undefined;
    }
  }

  startAvatarGeneration(options: { prompt: string }): void {
    const { prompt } = options;
    this.info('startAvatarGeneration', { prompt });

    void imageGenerationService
      .generateImage({ prompt })
      .then((result) => {
        this.info('startAvatarGeneration:done', { url: result.url });
        this.avatarUrl = result.url;
      })
      .catch((error) => {
        this.error('startAvatarGeneration:failed', error);
      });
  }

  cancel(): void {
    this.info('cancel');
    characterTextStreamService.cancel();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _compilePrompt(messages: ChatMessage[]): string {
    const lines: string[] = [];

    const systemMsg = messages.find((m) => m.role === 'system');
    if (systemMsg) {
      lines.push(systemMsg.content);
    }
    lines.push('');
    lines.push('--- Conversation History ---');

    const conversation = messages.filter((m) => m.role !== 'system');
    for (const msg of conversation) {
      const label = msg.role === 'user' ? 'Player' : 'DM';
      lines.push(`${label}: ${msg.content}`);
    }
    if (conversation.length === 0) {
      lines.push('Player: (new conversation — greet the player and start character creation)');
    }

    return lines.join('\n');
  }
}

export const characterCreationService: CharacterCreationServiceInterface =
  CharacterCreationService.create({
    className: 'CharacterCreationService',
  });

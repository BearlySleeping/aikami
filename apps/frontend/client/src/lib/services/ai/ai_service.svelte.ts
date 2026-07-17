// apps/frontend/client/src/lib/services/ai/ai_service.svelte.ts
//
// Legacy AI service — routes sendMessageToAI/createPersona through the
// AI Provider Gateway's `service`-mode text adapter (which wraps the
// Firebase `ai` callable), preserving the original public interface and
// undefined-on-error semantics. Contract: C-320 AC-2/AC-4.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { NpcData, PersonaData } from '@aikami/types';
import { aiGatewayService } from '$lib/services/ai/ai_gateway_service.svelte.ts';

export type AIServiceOptions = BaseFrontendClassOptions;

export type AIServiceInterface = BaseFrontendClassInterface & {
  /**
   * Sends a message to the AI.
   * @param text The text to send.
   * @param character The character data.
   * @returns The AI response.
   */
  sendMessageToAI(text: string, character?: PersonaData | NpcData): Promise<string | undefined>;

  /**
   * Creates a character using AI.
   * @param prompt The prompt to use for character creation.
   * @returns The created character data.
   */
  createPersona(prompt: string): Promise<PersonaData | undefined>;
};

export class AIService extends BaseFrontendClass<AIServiceOptions> implements AIServiceInterface {
  async createPersona(prompt: string): Promise<PersonaData | undefined> {
    this.log('createPersona', { prompt });
    try {
      // Explicit `service` mode: the gateway dispatches to the adapter
      // wrapping the hosted callable, bypassing capability resolution.
      const response = await aiGatewayService.generateText({
        messages: [{ role: 'user', content: prompt }],
        schemaName: 'createPersona',
        mode: 'service',
      });

      return response.structured as PersonaData | undefined;
    } catch (error) {
      this.error('createPersona', error);
    }
  }

  async sendMessageToAI(
    text: string,
    character?: PersonaData | NpcData,
  ): Promise<string | undefined> {
    this.log('sendMessage', { text, character });
    try {
      const response = await aiGatewayService.generateText({
        messages: [{ role: 'user', content: text }],
        mode: 'service',
      });

      return response.text;
    } catch (error) {
      this.error('sendMessage', error);
    }
  }
}

export const aiService: AIServiceInterface = AIService.create({
  className: 'AIService',
});

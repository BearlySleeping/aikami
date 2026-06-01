import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  firebaseFunctionsService,
} from '@aikami/frontend/services';
import type {
  AIMessageData,
  AIMessageResponse,
  AIMessageType,
  NpcData,
  PersonaData,
} from '@aikami/types';

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
      const response = await this._callAIEndpoint({
        type: 'createPersona',
        payload: {
          prompt,
        },
      });

      return response.persona;
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
      const response = await this._callAIEndpoint({
        type: 'sendMessage',
        payload: {
          text,
          context: {
            messages: [],
          },
        },
      });

      return response.text;
    } catch (error) {
      this.error('sendMessage', error);
    }
  }

  private async _callAIEndpoint<T extends AIMessageType>(
    data: AIMessageData<T>,
  ): Promise<AIMessageResponse<T>> {
    return await firebaseFunctionsService.call('ai', data);
  }
}

export const aiService: AIServiceInterface = new AIService({
  className: 'AIService',
});

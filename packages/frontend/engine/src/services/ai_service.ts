// apps/frontend/game/src/engine/services/ai_service.ts

import type { FrontendAiInterface } from '@aikami/types';

/**
 * Data about an item in the game.
 */
export type ItemData = {
  id: string;
  name: string;
  category: string;
  material?: string;
  properties?: Record<string, unknown>;
};

/**
 * Game-specific high-level AI service.
 *
 * Wraps a {@link FrontendAiInterface} provider with game-domain methods:
 * NPC dialogue generation, item description synthesis, and NPC speech TTS.
 *
 * The underlying AI provider is swappable at runtime — the game engine
 * uses {@link ai_config} to select the provider.
 *
 * This service is optional — the game engine works without it (NPCs
 * use static dialog, no procedural content).
 */
class GameAiService {
  private aiClient: FrontendAiInterface;

  /**
   * @param aiClient - The underlying AI provider.
   */
  constructor(aiClient: FrontendAiInterface) {
    this.aiClient = aiClient;
  }

  /**
   * Generates NPC dialogue triggered by player interaction.
   *
   * @param npcId - The NPC's unique identifier.
   * @param playerContext - What the player just said or did.
   * @param scene - The current game scene (for contextual dialogue).
   * @returns The NPC's spoken response.
   */
  async generateNpcDialogue(npcId: string, playerContext: string, scene?: string): Promise<string> {
    const response = await this.aiClient.generateDialogue({
      npcId,
      npcName: npcId,
      playerInput: playerContext,
      scene,
    });

    return response.text;
  }

  /**
   * Generates a text description for a procedurally created item.
   *
   * @param item - The item data to describe.
   * @returns A natural-language description of the item.
   */
  async generateItemDescription(item: ItemData): Promise<string> {
    const prompt = `Describe the following ${item.category} called "${item.name}"${item.material ? ` made of ${item.material}` : ''} for a fantasy RPG game. Keep it to 2-3 sentences.`;

    return this.aiClient.generateContentDescription(prompt);
  }

  /**
   * Synthesizes NPC dialog text into speech.
   *
   * Only works if the configured AI provider supports speech synthesis
   * (e.g. LocalTtsClient). Callers should check the provider's capabilities
   * before invoking this method.
   *
   * @param text - The dialog text to speak aloud.
   */
  async speakNpcDialog(text: string): Promise<void> {
    if (!this.aiClient.capabilities.speech) {
      return;
    }

    await this.aiClient.synthesizeSpeech(text);
  }

  /**
   * Returns the underlying AI provider's capabilities for runtime checks.
   */
  getCapabilities() {
    return this.aiClient.capabilities;
  }

  /**
   * Cleanup: releases any pending AI requests.
   */
  destroy(): void {
    // Currently a no-op — the AI provider handles its own lifecycle.
    // Future: abort pending requests on destroy.
  }
}

export { GameAiService };

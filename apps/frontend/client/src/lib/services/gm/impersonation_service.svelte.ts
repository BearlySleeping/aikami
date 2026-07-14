// apps/frontend/client/src/lib/services/gm/impersonation_service.svelte.ts
//
// Impersonation drafting service. Generates in-character messages for the
// player's persona using active persona data + recent chat context + optional
// direction text. The result is returned as a draft — never auto-sent.
//
// Contract: C-241 Chat Modes Address System

import { DEFAULT_IMPERSONATION_PROMPT_TEMPLATE } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { type TextChatMessage, textGenerationService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input required to generate an impersonation draft. */
export type ImpersonationDraftOptions = {
  /** The active persona's display name. */
  personaName: string;

  /** The active persona's personality traits / description. */
  personaTraits: string;

  /** Recent chat messages for conversational continuity (oldest first). */
  recentMessages: ReadonlyArray<{ sender: string; text: string }>;

  /** Optional direction text (e.g. "/impersonate I examine the runes"). */
  direction?: string;
};

export type ImpersonationServiceOptions = BaseFrontendClassOptions;

export type ImpersonationServiceInterface = BaseFrontendClassInterface & {
  /**
   * Generates an impersonation draft via the LLM and returns the raw text.
   *
   * The caller is responsible for placing the text in the chat input field.
   * The message is NEVER auto-sent — the user MUST review, edit, and send.
   *
   * @param options - Active persona data + context + optional direction.
   * @returns The generated draft text.
   * @throws If the LLM call fails.
   */
  generateDraft(options: ImpersonationDraftOptions): Promise<string>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ImpersonationService
  extends BaseFrontendClass<ImpersonationServiceOptions>
  implements ImpersonationServiceInterface
{
  /** @inheritdoc */
  async generateDraft(options: ImpersonationDraftOptions): Promise<string> {
    const { personaName, personaTraits, recentMessages, direction } = options;
    this.debug('generateDraft', { personaName, hasDirection: !!direction });

    const systemPrompt = this._buildPrompt({
      personaName,
      personaTraits,
      recentMessages,
      direction,
    });

    const messages: TextChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: direction ? `Direction: ${direction}` : 'What do I say next?' },
    ];

    let accumulated = '';

    try {
      await textGenerationService.streamChat({
        messages,
        onChunk: (chunk: string) => {
          accumulated += chunk;
        },
      });
    } catch (error) {
      this.error('generateDraft:stream-failed', error);
      throw error;
    }

    this.debug('generateDraft:complete', { length: accumulated.length });

    if (!accumulated.trim()) {
      throw new Error('Impersonation draft returned empty — try again.');
    }

    return accumulated.trim();
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Builds the impersonation system prompt from the template.
   * Substitutes {{personaName}}, {{personaTraits}}, {{direction}},
   * and {{recentContext}} placeholders.
   */
  private _buildPrompt(options: ImpersonationDraftOptions): string {
    const { personaName, personaTraits, recentMessages, direction } = options;

    // Format recent context
    const recentContext =
      recentMessages.length > 0
        ? recentMessages
            .slice(-10)
            .map((m) => `${m.sender === 'user' ? personaName : 'Other'}: ${m.text}`)
            .join('\n')
        : '(No recent messages)';

    let prompt = DEFAULT_IMPERSONATION_PROMPT_TEMPLATE.replaceAll('{{personaName}}', personaName)
      .replaceAll('{{personaTraits}}', personaTraits)
      .replaceAll('{{recentContext}}', recentContext);

    // Handle optional direction block with a simple mustache-ish replace
    if (direction) {
      prompt = prompt
        .replace('{{#direction}}', '')
        .replace('{{/direction}}', '')
        .replace('{{direction}}', direction);
    } else {
      // Remove the entire direction block
      prompt = prompt.replace(/{{#direction}}\nDirection: {{direction}}\n{{\/direction}}/g, '');
    }

    return prompt;
  }
}

export { ImpersonationService };

/**
 * Shared singleton instance of the impersonation service.
 */
export const impersonationService: ImpersonationServiceInterface = ImpersonationService.create({
  className: 'ImpersonationService',
}) as ImpersonationServiceInterface;

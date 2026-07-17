// packages/frontend/ai-gateway/src/lib/adapter_registry.ts
//
// Registry of adapters keyed by (capability, mode). The gateway dispatches
// through this registry after mode resolution.
// Contract: C-320

import type { AiCapability, AiMode } from '@aikami/types';
import type { AiAdapter, AiImageAdapter, AiTextAdapter, AiVoiceAdapter } from './gateway_types.ts';

/** Registry of adapters keyed by (capability, mode). */
export type AiAdapterRegistry = {
  registerText(options: { mode: AiMode; adapter: AiTextAdapter }): void;
  registerImage(options: { mode: AiMode; adapter: AiImageAdapter }): void;
  registerVoice(options: { mode: AiMode; adapter: AiVoiceAdapter }): void;
  getText(mode: AiMode): AiTextAdapter | undefined;
  getImage(mode: AiMode): AiImageAdapter | undefined;
  getVoice(mode: AiMode): AiVoiceAdapter | undefined;
  /** All registered (capability, mode, adapter) entries — used by contract tests. */
  entries(): Array<{ capability: AiCapability; mode: AiMode; adapter: AiAdapter }>;
};

/**
 * Creates an empty adapter registry.
 */
export const createAdapterRegistry = (): AiAdapterRegistry => {
  const text = new Map<AiMode, AiTextAdapter>();
  const image = new Map<AiMode, AiImageAdapter>();
  const voice = new Map<AiMode, AiVoiceAdapter>();

  return {
    registerText(options: { mode: AiMode; adapter: AiTextAdapter }): void {
      text.set(options.mode, options.adapter);
    },
    registerImage(options: { mode: AiMode; adapter: AiImageAdapter }): void {
      image.set(options.mode, options.adapter);
    },
    registerVoice(options: { mode: AiMode; adapter: AiVoiceAdapter }): void {
      voice.set(options.mode, options.adapter);
    },
    getText(mode: AiMode): AiTextAdapter | undefined {
      return text.get(mode);
    },
    getImage(mode: AiMode): AiImageAdapter | undefined {
      return image.get(mode);
    },
    getVoice(mode: AiMode): AiVoiceAdapter | undefined {
      return voice.get(mode);
    },
    entries(): Array<{ capability: AiCapability; mode: AiMode; adapter: AiAdapter }> {
      const result: Array<{ capability: AiCapability; mode: AiMode; adapter: AiAdapter }> = [];
      for (const [mode, adapter] of text) {
        result.push({ capability: 'text', mode, adapter });
      }
      for (const [mode, adapter] of image) {
        result.push({ capability: 'image', mode, adapter });
      }
      for (const [mode, adapter] of voice) {
        result.push({ capability: 'voice', mode, adapter });
      }
      return result;
    },
  };
};

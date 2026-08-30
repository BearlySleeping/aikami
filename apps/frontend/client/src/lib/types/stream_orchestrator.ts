// apps/frontend/client/src/lib/types/stream_orchestrator.ts

import type {
  BaseFrontendClassInterface,
  BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { AudioQueuePlayerInterface } from '../services/audio/audio_queue_player';
import type { ConversationMessage } from '../services/chat/context_builder.ts';
import type { ConversationStorageInterface } from '../services/chat/conversation_storage.svelte.ts';
import type { ExpressionAssetResolverInterface } from '../services/expression/expression_asset_resolver';
import type { PixiTextureInjectorInterface } from '../services/game/pixi_texture_injector';

/** SSE connection used by the stream orchestrator for incremental text. */
export type TextStreamConnection = {
  start(options: {
    signal: AbortSignal;
    onChunk: (text: string) => void;
    messages: ConversationMessage[];
  }): Promise<void>;
};

/** Image-stream connection used by the stream orchestrator. */
export type ImageStreamConnection = {
  connect(options: { signal: AbortSignal; onComplete: (buffer: ArrayBuffer) => void }): void;
  close(): void;
};

/** Dependencies and callbacks used to construct a stream orchestrator. */
export type StreamOrchestratorOptions = BaseFrontendClassOptions & {
  textStream: TextStreamConnection;
  imageStream: ImageStreamConnection;
  audioQueuePlayer: AudioQueuePlayerInterface;
  textureInjector: PixiTextureInjectorInterface;
  conversationStorage?: ConversationStorageInterface;
  onEmotionExtracted?: (options: { npcId: string; emotion: string }) => void;
  tagBufferTimeoutMs?: number;
  expressionAssetResolver?: ExpressionAssetResolverInterface;
  expressionGenerator?: (options: {
    npcId: string;
    emotion: string;
    signal: AbortSignal;
  }) => Promise<ArrayBuffer>;
};

/** Public lifecycle and generation contract for a stream orchestrator. */
export type StreamOrchestratorInterface = BaseFrontendClassInterface & {
  readonly isGenerating: boolean;
  readonly currentText: string;
  readonly currentSpeakerId: string | undefined;
  readonly currentAudioQueueSize: number;

  generateDialogue(options: {
    prompt: string;
    npcId: string;
    personaId: string;
    messages?: ConversationMessage[];
    chatId?: string;
  }): Promise<void>;

  cancelGeneration(): void;
};

// apps/frontend/pwa/src/lib/views/dev/voice/voice_view_model.svelte.ts

import { EMULATOR_PORTS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { ttsService } from '$services';

export type VoiceViewModelInterface = BaseViewModelInterface & {
  /** The script text to synthesize. */
  readonly text: string;
  /** Whether audio generation/playback is currently active. */
  readonly isPlaying: boolean;
  /** Whether a WebSocket connection is open to the voice service. */
  readonly isConnected: boolean;
  /** Triggers TTS via WebSocket streaming to the voice microservice. */
  generateAndPlay(): Promise<void>;
  /** Stops playback and closes the WebSocket. */
  cancel(): void;
};

export type VoiceViewModelOptions = BaseViewModelOptions & {};

class VoiceViewModel
  extends BaseViewModel<VoiceViewModelOptions>
  implements VoiceViewModelInterface
{
  text = $state('');
  isConnected = $state(false);

  private _ws: WebSocket | undefined;

  get isPlaying(): boolean {
    return ttsService.isPlaying;
  }

  // ── Public API ────────────────────────────────────────────────────────

  async generateAndPlay(): Promise<void> {
    this.debug('generateAndPlay', { textLength: this.text.length });

    // Connect to the voice microservice via WebSocket
    const voicePort = EMULATOR_PORTS.voice;
    const wsUrl = `ws://localhost:${voicePort}`;

    this._ws = new WebSocket(wsUrl);
    this._ws.binaryType = 'arraybuffer';

    this._ws.onopen = () => {
      this.debug('ws:open', { wsUrl });
      this.isConnected = true;

      // Start streaming session
      ttsService.startStream({ messageId: `voice_${Date.now()}`, text: this.text });

      // Send text to the voice service
      this._ws?.send(JSON.stringify({ type: 'text', data: this.text }));
      this._ws?.send(JSON.stringify({ type: 'end' }));
    };

    this._ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // Control message (JSON)
        try {
          const msg = JSON.parse(event.data);
          this.debug('ws:control', msg);
          if (msg.type === 'audio_end') {
            ttsService.endStream();
          }
        } catch {
          this.debug('ws:unexpected_text', { data: event.data });
        }
        return;
      }

      // Binary audio chunk
      if (event.data instanceof ArrayBuffer) {
        void ttsService.enqueueChunk({ buffer: event.data });
      }
    };

    this._ws.onerror = (event) => {
      this.error('ws:error', event);
      ttsService.stop();
    };

    this._ws.onclose = () => {
      this.debug('ws:close');
      this.isConnected = false;
      this._ws = undefined;
    };
  }

  cancel(): void {
    this.debug('cancel');
    ttsService.stop();
    if (this._ws) {
      this._ws.close();
      this._ws = undefined;
    }
    this.isConnected = false;
  }
}

export const getVoiceViewModel = (options: VoiceViewModelOptions): VoiceViewModelInterface =>
  new VoiceViewModel(options);

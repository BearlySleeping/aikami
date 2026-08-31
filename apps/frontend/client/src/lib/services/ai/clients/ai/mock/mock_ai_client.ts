// packages/frontend/engine/src/ai_clients/ai/mock/mock_ai_client.ts

import type { TSchema } from 'typebox';

import type { FrontendAiInterface } from '../frontend_ai_interface.ts';
import type {
  AiProviderCapabilities,
  ContentDescriptionOptions,
  DialogueContext,
  DialogueOptions,
  DialogueResponse,
  HealthCheckResult,
  ImageOptions,
  ImageResult,
  SpeechResult,
  TtsOptions,
} from '../types.ts';

/**
 * Call record stored in the mock's call history.
 */
type CallRecord = {
  method: string;
  args: unknown[];
  timestamp: number;
};

/**
 * Fail mode for simulating provider failures in tests.
 */
type FailMode = 'none' | 'network_error' | 'rate_limited' | 'timeout' | 'server_error';

/**
 * Deterministic mock implementation of {@link FrontendAiInterface}.
 *
 * Zero network calls, zero dependencies on vendor SDKs or local services.
 * Ideal for TDD, CI, and watch-mode development.
 *
 * Features:
 * - Seedable responses for deterministic test assertions
 * - Full call history recording for verification
 * - Configurable fail modes for error-path testing
 * - All methods return immediately (no async delays unless configured)
 */
class MockAiClient implements FrontendAiInterface {
  readonly name = 'mock';
  readonly capabilities: AiProviderCapabilities = {
    dialogue: true,
    contentDescription: true,
    speech: true,
    image: true,
    structured: true,
    requiresBackend: false,
    isLocal: true,
  };

  /** Seedable dialogue responses — keyed by input text pattern. */
  private _dialogueSeeds: Map<string, DialogueResponse> = new Map();

  /** Seedable description responses — keyed by prompt. */
  private _descriptionSeeds: Map<string, string> = new Map();

  /** Seedable structured data responses — keyed by schema name. */
  private _structuredSeeds: Map<string, unknown> = new Map();

  /** Call history for test assertions. */
  private _callHistory: CallRecord[] = [];

  /** Fail mode for simulating errors. */
  private _failModeInternal: FailMode = 'none';

  /** Artificial latency in milliseconds (0 = immediate). */
  private _latencyMs = 0;

  /**
   * Seeds a dialogue response for a given input pattern.
   *
   * If the input contains the pattern string, the seed response is returned.
   *
   * @param pattern — Substring to match against the player input.
   * @param response — The dialogue response to return.
   */
  seedDialogue(pattern: string, response: DialogueResponse): void {
    this._dialogueSeeds.set(pattern, response);
  }

  /**
   * Seeds a description response for a given prompt pattern.
   *
   * @param pattern — Substring to match against the prompt.
   * @param response — The description text to return.
   */
  seedDescription(pattern: string, response: string): void {
    this._descriptionSeeds.set(pattern, response);
  }

  /**
   * Seeds a structured data response for a given instruction pattern.
   *
   * @param pattern — Substring to match against the instruction.
   * @param data — The structured data to return.
   */
  seedStructured<T>(pattern: string, data: T): void {
    this._structuredSeeds.set(pattern, data as unknown);
  }

  /**
   * Sets the fail mode for simulating provider errors.
   *
   * @param mode — The fail mode.
   */
  setFailMode(mode: FailMode): void {
    this._failModeInternal = mode;
  }

  /**
   * Sets an artificial latency for all responses (for timing tests).
   *
   * @param ms — Latency in milliseconds.
   */
  setLatency(ms: number): void {
    this._latencyMs = ms;
  }

  /**
   * Returns the full call history for test assertions.
   */
  getCallHistory(): ReadonlyArray<CallRecord> {
    return this._callHistory;
  }

  /**
   * Clears all seeded responses, call history, and resets fail mode.
   */
  reset(): void {
    this._dialogueSeeds.clear();
    this._descriptionSeeds.clear();
    this._structuredSeeds.clear();
    this._callHistory = [];
    this._failModeInternal = 'none';
    this._latencyMs = 0;
  }

  // -----------------------------------------------------------------------
  // FrontendAiInterface Implementation
  // -----------------------------------------------------------------------

  async generateDialogue(
    context: DialogueContext,
    options?: DialogueOptions,
  ): Promise<DialogueResponse> {
    this._recordCall('generateDialogue', [context, options]);
    await this._simulateLatency();
    this._checkFailMode();

    // Check seeded responses
    for (const [pattern, response] of this._dialogueSeeds) {
      if (context.playerInput.includes(pattern)) {
        return response;
      }
    }

    // Default response
    return {
      text: `Hello, ${context.npcName} speaks to you.`,
      usage: { promptTokens: 50, completionTokens: 20 },
    };
  }

  async generateContentDescription(
    prompt: string,
    options?: ContentDescriptionOptions,
  ): Promise<string> {
    this._recordCall('generateContentDescription', [prompt, options]);
    await this._simulateLatency();
    this._checkFailMode();

    for (const [pattern, response] of this._descriptionSeeds) {
      if (prompt.includes(pattern)) {
        return response;
      }
    }

    return `A description of: ${prompt}`;
  }

  async synthesizeSpeech(text: string, options?: TtsOptions): Promise<SpeechResult> {
    this._recordCall('synthesizeSpeech', [text, options]);
    await this._simulateLatency();
    this._checkFailMode();

    return {
      audioData: null,
      durationMs: 0,
      voicesAvailable: ['mock-default'],
    };
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<ImageResult> {
    this._recordCall('generateImage', [prompt, options]);
    await this._simulateLatency();
    this._checkFailMode();

    return {
      imageUrl: 'mock://placeholder.png',
      width: options?.width ?? 512,
      height: options?.height ?? 512,
      mimeType: 'image/png',
    };
  }

  async generateStructured<T>(instruction: string, schema: TSchema, context?: string): Promise<T> {
    this._recordCall('generateStructured', [instruction, schema, context]);
    await this._simulateLatency();
    this._checkFailMode();

    const schemaName = String((schema as Record<string, unknown>).description) || instruction;

    // Check seeded responses
    for (const [pattern, data] of this._structuredSeeds) {
      if (schemaName.includes(pattern) || instruction.includes(pattern)) {
        return data as T;
      }
    }

    // Try to parse a default from the schema
    // Wrap in try/catch since some schemas require non-optional fields
    try {
      // TypeBox v1.x: no built-in parse — returning empty object
      return {} as T;
    } catch {
      // Fallback: return a minimal stub object with string/number defaults
      return {} as T;
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    this._recordCall('healthCheck', []);
    await this._simulateLatency();

    if (this._failModeInternal === 'network_error') {
      return { available: false, latencyMs: 0, message: 'Simulated network error' };
    }

    return { available: true, latencyMs: 0, message: 'Mock provider ready' };
  }

  // -----------------------------------------------------------------------
  // Internal Helpers
  // -----------------------------------------------------------------------

  private _recordCall(method: string, args: unknown[]): void {
    this._callHistory.push({ method, args, timestamp: Date.now() });
  }

  private async _simulateLatency(): Promise<void> {
    if (this._latencyMs > 0) {
      return new Promise((resolve) => setTimeout(resolve, this._latencyMs));
    }
  }

  private _checkFailMode(): void {
    switch (this._failModeInternal) {
      case 'network_error':
        throw new Error('Simulated network error');
      case 'rate_limited':
        throw new Error('Simulated rate limit exceeded');
      case 'timeout':
        throw new Error('Simulated timeout');
      case 'server_error':
        throw new Error('Simulated server error');
      case 'none':
        break;
    }
  }
}

export type { CallRecord, FailMode };
export { MockAiClient };

// apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts
//
// Singleton service that shapes AI capability snapshots for the pre-game
// capability screen and in-game boot diagnostics. Every provider
// availability decision is delegated to the AI Provider Gateway (C-320) —
// this service only maps gateway detection results into the existing
// CapabilitySnapshot shape.
// Contracts: C-318 (origin), C-322 (gateway delegation)

import { toDetectionStatus } from '@aikami/frontend/ai-gateway';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  AiCapability,
  AiDetectionResult,
  CapabilitySnapshot,
  DetectionStatus,
} from '@aikami/types';
import { aiGatewayService } from '$services';

// ── Types ──────────────────────────────────────────────────────────────

export type CapabilityServiceInterface = BaseFrontendClassInterface & {
  /** Runs full capability detection: text + image + voice. */
  detect(): Promise<CapabilitySnapshot>;
  /** Detects text AI availability via the gateway. */
  detectText(): Promise<DetectionStatus>;
  /** Detects image AI availability via the gateway. */
  detectImage(): Promise<DetectionStatus>;
};

// ── Service ────────────────────────────────────────────────────────────

class CapabilityService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements CapabilityServiceInterface
{
  /**
   * Runs full capability detection across all provider types.
   * The three gateway checks run concurrently — a hanging text check does
   * not block image/voice results. Individual gateway failures degrade to
   * an 'error' status; the snapshot itself always completes.
   */
  async detect(): Promise<CapabilitySnapshot> {
    const [textResult, imageResult, voiceResult] = await Promise.all([
      this._safeDetect('text'),
      this._safeDetect('image'),
      this._safeDetect('voice'),
    ]);

    const textStatus = this._toStatus(textResult);
    const imageStatus = this._toStatus(imageResult);
    const voiceStatus = this._toStatus(voiceResult);

    const providerId = textResult?.available ? textResult.provider : undefined;
    const modelName = textResult?.available ? this._resolveTextModel() : undefined;

    return {
      isComplete: true,
      textStatus,
      textProviderId: providerId,
      textModelName: modelName,
      imageStatus,
      voiceStatus,
      detectedAt: new Date().toISOString(),
      summary: this._buildSummary({ textStatus, providerId, modelName }),
    };
  }

  /** Detects text AI availability via the gateway (Ollama ping + cloud config). */
  async detectText(): Promise<DetectionStatus> {
    return this._toStatus(await this._safeDetect('text'));
  }

  /** Detects image AI availability via the gateway (ComfyUI ping + config). */
  async detectImage(): Promise<DetectionStatus> {
    return this._toStatus(await this._safeDetect('image'));
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Runs a gateway detection, degrading any thrown error to `undefined`
   * so detection failures never propagate to ViewModels.
   */
  private async _safeDetect(capability: AiCapability): Promise<AiDetectionResult | undefined> {
    try {
      return await aiGatewayService.detect(capability);
    } catch (error) {
      this.debug('_safeDetect:failed', { capability, error: String(error) });
      return undefined;
    }
  }

  /** Maps a gateway detection result (or a detection failure) to DetectionStatus. */
  private _toStatus(result: AiDetectionResult | undefined): DetectionStatus {
    if (!result) {
      return 'error';
    }
    return toDetectionStatus(result);
  }

  /**
   * Resolves the active text model name from the gateway. Resolution
   * throws when nothing is configured — a valid, non-exceptional outcome
   * that degrades to `undefined`.
   */
  private _resolveTextModel(): string | undefined {
    try {
      const resolution = aiGatewayService.resolveMode('text');
      return resolution.model && resolution.model.length > 0 ? resolution.model : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Builds a human-readable summary from detection results.
   */
  private _buildSummary(options: {
    textStatus: DetectionStatus;
    providerId?: string;
    modelName?: string;
  }): string {
    const { textStatus, providerId, modelName } = options;

    switch (textStatus) {
      case 'detected':
        if (modelName) {
          return `Local AI detected (${modelName} on ${providerId ?? 'ollama'})`;
        }
        return 'Local AI detected (Ollama)';
      case 'configured':
        return 'Cloud AI provider configured';
      case 'pending':
        return 'Detecting AI providers...';
      case 'error':
        return 'Detection error — offline demo available';
      case 'skipped':
        return 'Detection skipped';
      default:
        return 'No AI providers detected — offline demo available';
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

export const capabilityService: CapabilityServiceInterface = CapabilityService.create({
  className: 'CapabilityService',
});

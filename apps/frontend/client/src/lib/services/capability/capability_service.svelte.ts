// apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts
//
// Singleton service that shapes AI capability snapshots for the pre-game
// setup screen and in-game boot diagnostics. Every provider
// availability decision is delegated to the AI Provider Gateway (C-320) —
// this service only maps gateway detection results into the existing
// CapabilitySnapshot shape.
// Contracts: C-318 (origin), C-322 (gateway delegation)

import { toDetectionStatus } from '@aikami/frontend/ai-gateway';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type {
  AiCapability,
  AiDetectionResult,
  CapabilitySnapshot,
  DetectionStatus,
} from '@aikami/types';
import { aiGatewayService } from '../ai/ai_gateway_service.svelte.ts';

/** Options used to construct the AI capability-detection service. */
export type CapabilityServiceOptions = BaseFrontendClassOptions;
// ── Types ──────────────────────────────────────────────────────────────

export type CapabilityServiceInterface = BaseFrontendClassInterface & {
  /**
   * Runs capability detection. By default checks text + image + voice;
   * pass `capabilities` to probe only the capabilities the caller actually
   * requested (e.g. a setup flow where the user only enabled text + voice)
   * — un-requested capabilities are reported as `skipped`, never scanned.
   */
  detect(options?: { capabilities?: readonly AiCapability[] }): Promise<CapabilitySnapshot>;
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
  async detect(options?: { capabilities?: readonly AiCapability[] }): Promise<CapabilitySnapshot> {
    const requested = options?.capabilities;
    const wants = (capability: AiCapability): boolean =>
      !requested || requested.includes(capability);

    const [textResult, imageResult, voiceResult] = await Promise.all([
      wants('text') ? this._safeDetect('text') : undefined,
      wants('image') ? this._safeDetect('image') : undefined,
      wants('voice') ? this._safeDetect('voice') : undefined,
    ]);

    const textStatus = wants('text') ? this._toStatus(textResult) : 'skipped';
    const imageStatus = wants('image') ? this._toStatus(imageResult) : 'skipped';
    const voiceStatus = wants('voice') ? this._toStatus(voiceResult) : 'skipped';

    const providerId = textResult?.available ? textResult.provider : undefined;
    const modelName = textResult?.available ? this._resolveTextModel() : undefined;
    const imageProviderId = imageResult?.available ? imageResult.provider : undefined;
    const voiceProviderId = voiceResult?.available ? voiceResult.provider : undefined;

    return {
      isComplete: true,
      textStatus,
      textProviderId: providerId,
      textModelName: modelName,
      imageStatus,
      imageProviderId,
      voiceStatus,
      voiceProviderId,
      detectedAt: new Date().toISOString(),
      summary: this._buildSummary({ textStatus, imageStatus, voiceStatus, providerId, modelName }),
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
    imageStatus: DetectionStatus;
    voiceStatus: DetectionStatus;
    providerId?: string;
    modelName?: string;
  }): string {
    const { textStatus, imageStatus, voiceStatus, providerId, modelName } = options;

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
        return 'Detection error — retry or configure a provider';
      case 'skipped':
        return 'Detection skipped';
      default:
        // Check if image or voice capabilities are available even when text is not
        if (
          imageStatus === 'detected' ||
          imageStatus === 'configured' ||
          voiceStatus === 'detected' ||
          voiceStatus === 'configured'
        ) {
          return 'AI providers detected (image/voice available)';
        }
        return 'No text AI detected — install Ollama or add a cloud provider';
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

export const capabilityService: CapabilityServiceInterface = CapabilityService.create({
  className: 'CapabilityService',
});

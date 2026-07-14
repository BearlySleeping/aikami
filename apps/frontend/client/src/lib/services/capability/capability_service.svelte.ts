// apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts
//
// Singleton service that detects available AI providers at launch.
// Extracts shared provider-ping logic from BootDiagnosticsViewModel
// so both the pre-game capability screen and in-game diagnostics
// use the same detection backend.
// Contract: C-318

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { CapabilitySnapshot, DetectionStatus } from '@aikami/types';
import { aiSettingsService } from '$services';

// ── Constants ──────────────────────────────────────────────────────────

const OLLAMA_PROXY_PATH = '/api/text/' as const;
const OLLAMA_LOCAL_TAGS = 'http://localhost:11434/api/tags' as const;
const PING_TIMEOUT_MS = 3000;

// ── Types ──────────────────────────────────────────────────────────────

export type CapabilityServiceInterface = BaseFrontendClassInterface & {
  /** Runs full capability detection: text + image + voice. */
  detect(): Promise<CapabilitySnapshot>;
  /** Pings text providers only (Ollama + cloud config check). */
  detectText(): Promise<DetectionStatus>;
  /** Pings image providers (ComfyUI proxy). */
  detectImage(): Promise<DetectionStatus>;
  /** Checks whether a cloud text provider is configured. */
  checkCloudTextConfig(): DetectionStatus;
};

// ── Helpers ────────────────────────────────────────────────────────────

/** Performs a fetch with an abort timeout. */
const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Service ────────────────────────────────────────────────────────────

class CapabilityService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements CapabilityServiceInterface
{
  /**
   * Runs full capability detection across all provider types.
   * Individual checks are independent — a hanging text check does not
   * block image/voice results.
   */
  async detect(): Promise<CapabilitySnapshot> {
    const [textStatus, imageStatus, voiceStatus] = await Promise.all([
      this.detectText(),
      this.detectImage(),
      Promise.resolve('detected' as DetectionStatus), // Voice is always available (Kokoro WebGPU)
    ]);

    const isComplete = true;
    const providerId = textStatus === 'detected' ? 'ollama' : undefined;
    const modelName = textStatus === 'detected' ? this._readEnv('PUBLIC_OLLAMA_MODEL') : undefined;

    return {
      isComplete,
      textStatus,
      textProviderId: providerId,
      textModelName: modelName,
      imageStatus,
      voiceStatus,
      detectedAt: new Date().toISOString(),
      summary: this._buildSummary({ textStatus, imageStatus, voiceStatus, providerId, modelName }),
    };
  }

  /**
   * Detects text AI availability.
   *
   * Order:
   * 1. Check for configured cloud connections (vault + env).
   * 2. Ping Ollama via Vite dev proxy (primary path, same-origin → no CORS).
   * 3. Fallback: native fetch to localhost:11434/api/tags (CORS-limited).
   */
  async detectText(): Promise<DetectionStatus> {
    // Check for existing cloud config first
    const cloudStatus = this.checkCloudTextConfig();
    if (cloudStatus === 'configured') {
      return cloudStatus;
    }

    // Try Ollama via proxy
    const ollamaStatus = await this._pingOllama();
    return ollamaStatus;
  }

  /**
   * Detects image AI availability via ComfyUI proxy.
   * Returns 'detected' if already configured via aiSettingsService,
   * otherwise pings the Vite dev proxy.
   */
  async detectImage(): Promise<DetectionStatus> {
    try {
      const { imageProvider } = aiSettingsService;
      if (imageProvider.endpoint || imageProvider.model) {
        return 'configured';
      }
    } catch {
      // Fall through to proxy check
    }

    try {
      const response = await fetchWithTimeout('/api/image/object_info', PING_TIMEOUT_MS);
      return response.status < 500 ? 'detected' : 'not_found';
    } catch {
      return 'not_found';
    }
  }

  /**
   * Checks whether a cloud text provider is configured.
   * Returns 'configured' if an API key or endpoint+model exists.
   */
  checkCloudTextConfig(): DetectionStatus {
    try {
      const { textProvider } = aiSettingsService;
      if (textProvider.apiKey || (textProvider.endpoint && textProvider.model)) {
        return 'configured';
      }
      return 'not_found';
    } catch {
      return 'not_found';
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Pings Ollama via Vite dev proxy first, then native fetch as fallback.
   */
  private async _pingOllama(): Promise<DetectionStatus> {
    // Primary: Vite dev proxy (same-origin, no CORS issues)
    try {
      const response = await fetchWithTimeout(OLLAMA_PROXY_PATH, PING_TIMEOUT_MS);
      if (response.ok) {
        this.debug('_pingOllama:proxy-ok');
        return 'detected';
      }
    } catch {
      this.debug('_pingOllama:proxy-failed');
    }

    // Fallback: native fetch to localhost (CORS-limited in browser,
    // works in Tauri / Electron due to relaxed CSP)
    try {
      const response = await fetchWithTimeout(OLLAMA_LOCAL_TAGS, PING_TIMEOUT_MS);
      if (response.ok) {
        const body = (await response.json()) as { models?: unknown[] };
        const modelCount = Array.isArray(body.models) ? body.models.length : 0;
        this.debug('_pingOllama:native-ok', { modelCount });
        return 'detected';
      }
    } catch {
      // CORS rejection or connection refused — expected in browser mode
      this.debug('_pingOllama:native-failed');
    }

    return 'not_found';
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

  /** Safely reads a Vite PUBLIC_* env var. Returns undefined in tests. */
  private _readEnv(name: string): string | undefined {
    try {
      const value = (import.meta.env as Record<string, string | undefined>)[name];
      return value && value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

export const capabilityService: CapabilityServiceInterface = CapabilityService.create({
  className: 'CapabilityService',
});

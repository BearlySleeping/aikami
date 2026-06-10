// apps/frontend/pwa/src/lib/services/config/local_service_detector.ts
//
// Polls local microservice ports to detect running services.
// Each service is pinged via a lightweight HTTP request; a successful
// response (or any non-network-error) indicates "connected".
// Designed to work in both browser and Tauri (local) environments.

import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status for a single local service. */
export type ServiceStatus = 'connected' | 'disconnected' | 'checking';

/** Status snapshot for all monitored local services. */
export type LocalServiceStatus = {
  /** ComfyUI image generation service (port 8188). */
  comfyUi: ServiceStatus;
  /** Voice / TTS microservice (port 8089). */
  voice: ServiceStatus;
  /** Text generation microservice (port 11436). */
  text: ServiceStatus;
};

/** Endpoint configuration for a service to detect. */
export type ServiceEndpoint = {
  /** Unique key matching LocalServiceStatus fields. */
  key: keyof LocalServiceStatus;
  /** Base URL with port (e.g. 'http://localhost:8188'). */
  url: string;
  /** Optional health-check path appended to the base URL. */
  healthPath?: string;
};

// ---------------------------------------------------------------------------
// Detector interface
// ---------------------------------------------------------------------------

export type LocalServiceDetectorInterface = {
  /** Current status of all services. */
  readonly status: LocalServiceStatus;

  /** Runs detection against all configured services. */
  detectAll(): Promise<LocalServiceStatus>;
  /** Runs detection against a single service. */
  detectService(key: keyof LocalServiceStatus): Promise<ServiceStatus>;
};

// ---------------------------------------------------------------------------
// Default endpoints
// ---------------------------------------------------------------------------

/** Resolves a URL from an import.meta.env variable, falling back to a default. */
const resolveUrl = (envKey: string, fallback: string): string => {
  try {
    // Vite exposes import.meta.env.PUBLIC_* variables at build time.
    // In test/SSR contexts this may not exist.
    const viteEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (viteEnv && typeof viteEnv[envKey] === 'string') {
      return viteEnv[envKey];
    }
  } catch {
    // import.meta may not be available (e.g. in test)
  }
  return fallback;
};

const DEFAULT_ENDPOINTS: readonly ServiceEndpoint[] = [
  {
    key: 'comfyUi',
    url: resolveUrl('PUBLIC_IMAGE_URL', 'http://localhost:8188'),
  },
  {
    key: 'voice',
    url: resolveUrl('PUBLIC_VOICE_URL', 'http://localhost:8089'),
  },
  {
    key: 'text',
    url: resolveUrl('PUBLIC_OLLAMA_BASE_URL', 'http://localhost:11436'),
  },
] as const;

/** Timeout for each service ping in milliseconds. */
const PING_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class LocalServiceDetector implements LocalServiceDetectorInterface {
  status: LocalServiceStatus = {
    comfyUi: 'disconnected',
    text: 'disconnected',
    voice: 'disconnected',
  };

  private readonly _endpoints: readonly ServiceEndpoint[];
  private readonly _timeoutMs: number;

  constructor(options?: { endpoints?: ServiceEndpoint[]; timeoutMs?: number }) {
    this._endpoints = options?.endpoints ?? DEFAULT_ENDPOINTS;
    this._timeoutMs = options?.timeoutMs ?? PING_TIMEOUT_MS;
  }

  // ── Public API ────────────────────────────────────────────────────────

  async detectAll(): Promise<LocalServiceStatus> {
    logger.debug('LocalServiceDetector.detectAll');

    const results = await Promise.allSettled(this._endpoints.map((ep) => this._pingEndpoint(ep)));

    for (let i = 0; i < this._endpoints.length; i++) {
      const key = this._endpoints[i].key;
      const result = results[i];

      if (result.status === 'fulfilled') {
        this.status[key] = result.value;
      } else {
        this.status[key] = 'disconnected';
      }
    }

    return { ...this.status };
  }

  async detectService(key: keyof LocalServiceStatus): Promise<ServiceStatus> {
    const endpoint = this._endpoints.find((ep) => ep.key === key);
    if (!endpoint) {
      logger.warn('LocalServiceDetector.detectService: unknown key', { key });
      return 'disconnected';
    }

    const result = await this._pingEndpoint(endpoint);
    this.status[key] = result;
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async _pingEndpoint(endpoint: ServiceEndpoint): Promise<ServiceStatus> {
    const healthPath = endpoint.healthPath ?? '/';
    const targetUrl = `${endpoint.url.replace(/\/$/, '')}${healthPath}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this._timeoutMs);

      await fetch(targetUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return 'connected';
    } catch {
      // Network error, timeout, or CORS — treat as disconnected.
      return 'disconnected';
    }
  }
}

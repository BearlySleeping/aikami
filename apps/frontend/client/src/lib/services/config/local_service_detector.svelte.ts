// apps/frontend/client/src/lib/services/config/local_service_detector.svelte.ts
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
  /** Optional HTTP method for the health check (defaults to GET). */
  healthMethod?: string;
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

/** Default service endpoints (all proxied through Vite dev server). */
const DEFAULT_ENDPOINTS: readonly ServiceEndpoint[] = [
  {
    key: 'comfyUi',
    url: '/api/image',
    healthPath: '/object_info',
  },
  {
    key: 'voice',
    url: '/api/voice',
    healthPath: '/v1/models',
  },
  {
    key: 'text',
    url: '/api/text',
    healthPath: '/api/tags',
  },
] as const;

/** Timeout for each service ping in milliseconds. */
const PING_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class LocalServiceDetector implements LocalServiceDetectorInterface {
  status: LocalServiceStatus = $state({
    comfyUi: 'disconnected',
    text: 'disconnected',
    voice: 'disconnected',
  });

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

    // Build a fresh status object — Svelte tracks reference changes
    const newStatus: LocalServiceStatus = { ...this.status };

    for (let i = 0; i < this._endpoints.length; i++) {
      const key = this._endpoints[i].key;
      const result = results[i];
      newStatus[key] = result.status === 'fulfilled' ? result.value : 'disconnected';
    }

    this.status = newStatus;
    return this.status;
  }

  async detectService(key: keyof LocalServiceStatus): Promise<ServiceStatus> {
    const endpoint = this._endpoints.find((ep) => ep.key === key);
    if (!endpoint) {
      logger.warn('LocalServiceDetector.detectService: unknown key', { key });
      return 'disconnected';
    }

    const result = await this._pingEndpoint(endpoint);
    this.status = { ...this.status, [key]: result };
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async _pingEndpoint(endpoint: ServiceEndpoint): Promise<ServiceStatus> {
    const healthPath = endpoint.healthPath ?? '/';
    const method = endpoint.healthMethod ?? 'GET';
    const targetUrl = `${endpoint.url.replace(/\/$/, '')}${healthPath}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this._timeoutMs);

      const init: RequestInit = { method, signal: controller.signal };

      // POST health checks need a minimal JSON body
      if (method === 'POST') {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = JSON.stringify({});
      }

      const response = await fetch(targetUrl, init);

      clearTimeout(timeoutId);
      // 2xx/4xx = service is running (even if at wrong endpoint).
      // 5xx (e.g. Vite proxy 502 when upstream is down) = disconnected.
      return response.status < 500 ? 'connected' : 'disconnected';
    } catch {
      // Network error, timeout, or CORS — treat as disconnected.
      return 'disconnected';
    }
  }
}

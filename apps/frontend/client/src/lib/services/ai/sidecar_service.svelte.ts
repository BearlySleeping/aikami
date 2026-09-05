// apps/frontend/client/src/lib/services/ai/sidecar_service.svelte.ts
//
// Sidecar process lifecycle manager for local AI engines (C-467).
// Handles starting, stopping, and health-checking bundled engine binaries
// invoked through Tauri's sidecar API.
//
// AC-3: A started sidecar responds to health checks and registers as a
// normal local AiProvider/AiConnection through configService.
// AC-5: Quitting the app terminates all sidecar child processes.

import { BaseClass, type BaseClassInterface } from '@aikami/utils';
import type { ProbeResult, ProbeExecutor } from '@aikami/local-ai';

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Sidecar process lifecycle state (C-467 State & Data Models).
 * Tracked client-side only, never synced.
 */
export type SidecarState =
  | { readonly status: 'not-installed' }
  | { readonly status: 'downloading'; readonly progress: number }
  | { readonly status: 'starting' }
  | { readonly status: 'running'; readonly port: number }
  | { readonly status: 'error'; readonly reason: string };

/** Text engine sidecar configuration. */
export type TextEngineConfig = {
  /** Loopback port the engine binds to (EMULATOR_PORTS.text = 11434). */
  readonly port: number;
  /** Sidecar binary name registered in tauri.conf.json externalBin. */
  readonly binaryName: string;
  /** Model file path on disk (relative to app data dir). */
  readonly modelPath: string;
  /** Health-check endpoint path (e.g. "/health" for llama-server). */
  readonly healthEndpoint: string;
};

// ── Interface ─────────────────────────────────────────────────────────

export type SidecarServiceInterface = BaseClassInterface & {
  /** Current state of the text engine sidecar. */
  readonly state: SidecarState;
  /** Text engine config (port, binary name, model path). */
  readonly config: TextEngineConfig;

  /** Starts (or restarts) the sidecar with the given model and executor. */
  start(options: { modelPath: string; executor: ProbeExecutor }): Promise<void>;
  /** Stops a running sidecar. */
  stop(): Promise<void>;
  /** Health-checks a running sidecar; updates state on failure. */
  healthCheck(executor: ProbeExecutor): Promise<boolean>;
};

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_PORT = 11434;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const SIDECAR_START_TIMEOUT_MS = 10_000;
const SIDECAR_POLL_INTERVAL_MS = 500;

// ── Service ───────────────────────────────────────────────────────────

class SidecarService extends BaseClass implements SidecarServiceInterface {
  _state = $state<SidecarState>({ status: 'not-installed' });
  _config: TextEngineConfig = {
    port: DEFAULT_PORT,
    binaryName: 'llama-server',
    modelPath: '',
    healthEndpoint: '/health',
  };

  get state(): SidecarState {
    return this._state;
  }

  get config(): TextEngineConfig {
    return this._config;
  }

  /**
   * Starts the text engine sidecar.
   * 1. Health-checks the port first (reuse if already running).
   * 2. Launches the sidecar binary via Tauri shell command.
   * 3. Polls the health endpoint until ready or timeout.
   */
  async start(options: { modelPath: string; executor: ProbeExecutor }): Promise<void> {
    const { modelPath, executor } = options;

    // Already running — no-op
    if (this._state.status === 'running') {
      this.debug('start:already-running', { port: this._config.port });
      return;
    }

    this._config = { ...this._config, modelPath };
    this._state = { status: 'starting' };

    try {
      // Health-check the port first in case another process is already there
      const healthy = await this._checkHealth(executor);
      if (healthy) {
        this._state = { status: 'running', port: this._config.port };
        this.debug('start:port-already-in-use', { port: this._config.port });
        return;
      }

      // Launch the sidecar — use Tauri's sidecar API through invoke.
      // The sidecar binary is bundled via externalBin and resolved by Tauri.
      await this._launchSidecar(executor);

      // Poll for readiness
      const started = await this._waitForReady(executor);

      if (started) {
        this._state = { status: 'running', port: this._config.port };
        this.info('sidecar:started', { port: this._config.port, model: modelPath });
      } else {
        this._state = { status: 'error', reason: 'Sidecar failed to start within timeout' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._state = { status: 'error', reason: message };
      this.error('sidecar:start-failed', { error: message });
    }
  }

  /**
   * Stops a running sidecar. Sends a terminate signal through Tauri's
   * shell plugin.
   */
  async stop(): Promise<void> {
    if (this._state.status !== 'running') {
      return;
    }

    this.debug('sidecar:stopping', { port: this._config.port });

    try {
      await this._terminateSidecar();
      this._state = { status: 'not-installed' };
      this.info('sidecar:stopped');
    } catch (error) {
      this.warn('sidecar:stop-failed', error);
      this._state = { status: 'error', reason: 'Failed to stop sidecar' };
    }
  }

  /**
   * Health-checks the running sidecar by hitting its loopback endpoint.
   * Updates state to 'error' if the check fails.
   */
  async healthCheck(executor: ProbeExecutor): Promise<boolean> {
    if (this._state.status !== 'running') {
      return false;
    }

    const healthy = await this._checkHealth(executor);
    if (!healthy) {
      this._state = { status: 'error', reason: 'Sidecar is not responding' };
    }
    return healthy;
  }

  // ── Private: health check ───────────────────────────────────────────

  /**
   * Performs a health check against the sidecar's loopback port using the
   * probe executor (which on Tauri uses the Rust IPC; in tests uses fixture).
   */
  async _checkHealth(executor: ProbeExecutor): Promise<boolean> {
    try {
      // Use curl via the probe executor as a portable health-check mechanism
      const result: ProbeResult = await executor.run('curl', [
        '-sf',
        '--max-time',
        '2',
        `http://localhost:${this._config.port}${this._config.healthEndpoint}`,
      ], { timeoutMs: HEALTH_CHECK_TIMEOUT_MS });

      return result.ok;
    } catch {
      return false;
    }
  }

  // ── Private: sidecar launch (placeholder) ───────────────────────────

  /**
   * Launches the sidecar binary. Uses Tauri's shell plugin sidecar API.
   * For now, this is a placeholder that uses the probe executor to start
   * the process. In production, this would use @tauri-apps/plugin-shell's
   * Command.sidecar() API.
   *
   * TODO(C-467): Replace with actual sidecar launch once the binary is
   * bundled via externalBin in tauri.conf.json.
   */
  async _launchSidecar(_executor: ProbeExecutor): Promise<void> {
    // Sidecar launching is deferred — the shell plugin sidecar API requires
    // the binary to be declared in tauri.conf.json's externalBin and bundled
    // with the app. This implementation will be completed when the llama-server
    // binary is available as a bundled sidecar.
    this.debug('_launchSidecar:placeholder', {
      binary: this._config.binaryName,
      port: this._config.port,
    });

    // For now, we assume the engine is started externally (Docker/native)
    // and the health-check polling will find it. When the sidecar binary is
    // bundled, this method will invoke:
    //   const cmd = Command.sidecar('llama-server', [
    //     '-m', this._config.modelPath,
    //     '--port', String(this._config.port),
    //     '--host', '127.0.0.1',
    //   ]);
    //   cmd.spawn();
    throw new Error('Sidecar launch not yet implemented — engine must be started externally');
  }

  /**
   * Terminates a running sidecar process. Placeholder until the shell
   * plugin's sidecar handle is available.
   */
  async _terminateSidecar(): Promise<void> {
    this.debug('_terminateSidecar:placeholder');
    // TODO(C-467): Kill the sidecar child process handle.
  }

  // ── Private: readiness polling ──────────────────────────────────────

  /**
   * Polls the health endpoint until the sidecar responds or timeout.
   */
  async _waitForReady(executor: ProbeExecutor): Promise<boolean> {
    const deadline = Date.now() + SIDECAR_START_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const healthy = await this._checkHealth(executor);
      if (healthy) {
        return true;
      }
      await this._sleep(SIDECAR_POLL_INTERVAL_MS);
    }

    return false;
  }

  /** Promise-based sleep helper. */
  _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

export const sidecarService: SidecarServiceInterface = SidecarService.create({
  className: 'SidecarService',
});

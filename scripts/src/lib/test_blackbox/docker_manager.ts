// scripts/src/lib/test_blackbox/docker_manager.ts
// Docker container lifecycle manager for blackbox tests.
// Builds, runs, polls, and tears down Docker containers for AI backend services.
// Mirrors the TmuxManager interface so it can plug into run.ts seamlessly.
//
// Key features:
//   - --add-host=host.docker.internal:host-gateway for cross-platform networking
//   - Health-check polling via HTTP endpoint
//   - Clean teardown on test completion

import { execSync, spawn } from 'node:child_process';

/** Configuration for a single Docker-backed service. */
export type DockerServiceConfig = {
  /** Human-readable service name (e.g. 'ai-image-gen') */
  name: string;
  /** Path to the build context (e.g. 'apps/backend/ai-image-gen') */
  contextPath: string;
  /** Dockerfile name within contextPath */
  dockerfile: string;
  /** Internal container port the service listens on */
  port: number;
  /** Environment variables passed to the container */
  env: Record<string, string>;
  /** HTTP path to poll for readiness (e.g. '/health') */
  healthCheckPath: string;
};

/** Status of a Docker container managed by DockerManager. */
type ContainerStatus = {
  config: DockerServiceConfig;
  containerId: string | undefined;
  hostPort: number | undefined;
  state: 'pending' | 'building' | 'starting' | 'healthy' | 'failed' | 'stopped';
  error?: string;
};

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_START_TIMEOUT_MS = 120_000;

/**
 * Manages Docker container lifecycle for blackbox testing.
 * Automatically injects FIREBASE_AUTH_EMULATOR_HOST and
 * FIRESTORE_EMULATOR_HOST into container environment so
 * containerized services can reach the host-bound emulators.
 */
export class DockerManager {
  private readonly _containers = new Map<string, ContainerStatus>();
  private readonly _projectRoot: string;

  constructor(options: { projectRoot?: string } = {}) {
    this._projectRoot = options.projectRoot ?? process.cwd();
  }

  /**
   * Returns true if Docker is available on this system.
   */
  async isDockerAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('docker', ['info'], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Builds and starts a single Docker service.
   */
  async startService(
    config: DockerServiceConfig,
    options: { timeoutMs?: number; hostPort?: number } = {},
  ): Promise<void> {
    const { timeoutMs = DEFAULT_START_TIMEOUT_MS, hostPort } = options;
    const key = config.name;

    if (this._containers.has(key)) {
      console.log(`  ✓ Docker container '${key}' already managed — skipping`);
      return;
    }

    const status: ContainerStatus = {
      config,
      containerId: undefined,
      hostPort,
      state: 'pending',
    };
    this._containers.set(key, status);

    try {
      await this._buildImage(config, status);
      await this._runContainer(config, status);
      await this._waitForHealthy(config, status, timeoutMs);
      console.log(`  ✓ Docker service '${key}' healthy on :${status.hostPort}`);
    } catch (e) {
      status.state = 'failed';
      status.error = e instanceof Error ? e.message : String(e);
      throw new Error(`Docker service '${key}' failed: ${status.error}`);
    }
  }

  /**
   * Builds and starts multiple Docker services in parallel.
   */
  async startServices(
    configs: DockerServiceConfig[],
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    console.log(`🐳 Starting ${configs.length} Docker service(s)...`);
    await Promise.all(configs.map((c) => this.startService(c, options)));
  }

  /**
   * Stops a single container by config name.
   */
  async stopService(name: string): Promise<void> {
    const status = this._containers.get(name);
    if (!status) {
      return;
    }

    await this._stopContainer(status);
    this._containers.delete(name);
    console.log(`  ✓ Docker container '${name}' stopped`);
  }

  /**
   * Stops all managed containers.
   */
  async stopAllServices(): Promise<void> {
    const names = [...this._containers.keys()];
    if (names.length === 0) {
      return;
    }
    console.log(`🐳 Stopping ${names.length} Docker service(s)...`);
    await Promise.all(names.map((n) => this.stopService(n)));
    console.log('✓ All Docker services stopped');
  }

  // ── Private helpers ───────────────────────────────────────

  /**
   * Builds the Docker image for a service.
   */
  private async _buildImage(config: DockerServiceConfig, status: ContainerStatus): Promise<void> {
    status.state = 'building';
    console.log(`  🔨 Building Docker image for '${config.name}'...`);

    const tag = `aikami-e2e-${config.name}:latest`;

    try {
      execSync(`docker build -t ${tag} -f ${config.dockerfile} ${config.contextPath}`, {
        cwd: this._projectRoot,
        stdio: 'pipe',
        timeout: 180_000,
      });
    } catch (e) {
      throw new Error(
        `Docker build failed for '${config.name}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    console.log(`  ✓ Docker image built: ${tag}`);
  }

  /**
   * Runs a Docker container in detached mode.
   * Injects host.docker.internal for cross-platform emulator access.
   */
  private async _runContainer(config: DockerServiceConfig, status: ContainerStatus): Promise<void> {
    status.state = 'starting';
    const tag = `aikami-e2e-${config.name}:latest`;

    // Assign a host port if not explicitly set
    const hostPort = status.hostPort ?? this._findFreePort(config.port);
    status.hostPort = hostPort;

    // Build environment variable list for docker run
    const envArgs: string[] = [];
    for (const [key, value] of Object.entries(config.env)) {
      envArgs.push('--env', `${key}=${value}`);
    }

    // Inject emulator host variables so the container can reach host services
    const emulatorEnv = this._buildEmulatorEnv();
    for (const [key, value] of Object.entries(emulatorEnv)) {
      envArgs.push('--env', `${key}=${value}`);
    }

    const args = [
      'run',
      '--rm',
      '--detach',
      // Cross-platform host networking — works on macOS (Docker Desktop)
      // and Linux (via host-gateway, requires Docker 20.10+)
      '--add-host=host.docker.internal:host-gateway',
      '--publish',
      `${hostPort}:${config.port}`,
      '--name',
      `aikami-e2e-${config.name}`,
      ...envArgs,
      tag,
    ];

    console.log(`  🚀 Starting container '${config.name}' on host port ${hostPort}...`);

    try {
      const containerId = execSync(`docker ${args.join(' ')}`, {
        cwd: this._projectRoot,
        encoding: 'utf8',
        timeout: 30_000,
      }).trim();
      status.containerId = containerId;
    } catch (e) {
      throw new Error(
        `Docker run failed for '${config.name}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Polls the health check endpoint until the container reports healthy.
   */
  private async _waitForHealthy(
    config: DockerServiceConfig,
    status: ContainerStatus,
    timeoutMs: number,
  ): Promise<void> {
    const hostPort = status.hostPort;
    if (!hostPort) {
      throw new Error(`No host port assigned for '${config.name}'`);
    }

    const url = `http://localhost:${hostPort}${config.healthCheckPath}`;
    const deadline = Date.now() + timeoutMs;

    console.log(`  ⏳ Waiting for '${config.name}' health check: ${url}`);

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (resp.ok) {
          status.state = 'healthy';
          return;
        }
      } catch {
        // Not ready yet — retry after interval
      }
      await new Promise((r) => setTimeout(r, DEFAULT_POLL_INTERVAL_MS));
    }

    throw new Error(`Health check timed out for '${config.name}' at ${url}`);
  }

  /**
   * Stops and removes a Docker container.
   */
  private async _stopContainer(status: ContainerStatus): Promise<void> {
    const containerId = status.containerId;
    if (!containerId) {
      return;
    }

    try {
      execSync(`docker stop ${containerId}`, {
        stdio: 'ignore',
        timeout: 10_000,
      });
    } catch {
      // Container may already be stopped — force remove
      try {
        execSync(`docker rm -f ${containerId}`, { stdio: 'ignore', timeout: 5_000 });
      } catch {
        // Best effort cleanup
      }
    }
  }

  /**
   * Builds the emulator host environment variables for container injection.
   * Uses host.docker.internal so containerized services can reach
   * Firebase emulators running on the host machine.
   */
  private _buildEmulatorEnv(): Record<string, string> {
    return {
      // Firebase Auth emulator — container reaches host via host.docker.internal
      FIREBASE_AUTH_EMULATOR_HOST: 'host.docker.internal:9098',
      // Firestore emulator
      FIRESTORE_EMULATOR_HOST: 'host.docker.internal:8081',
      // Functions emulator
      FIREBASE_FUNCTIONS_EMULATOR_HOST: 'host.docker.internal:5003',
      // Storage emulator
      FIREBASE_STORAGE_EMULATOR_HOST: 'host.docker.internal:9198',
      // Emulator project ID
      FIREBASE_PROJECT_ID: 'demo-aikami-emulator',
    };
  }

  /**
   * Finds a free port in a range starting from the desired port.
   * Simple sequential probe.
   */
  private _findFreePort(basePort: number): number {
    // For now, return basePort + 10000 offset to avoid conflicts with host services
    // In a full implementation, this would probe for availability
    return basePort + 10_000;
  }
}

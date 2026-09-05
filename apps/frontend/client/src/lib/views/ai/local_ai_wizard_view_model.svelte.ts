// apps/frontend/client/src/lib/views/ai/local_ai_wizard_view_model.svelte.ts
//
// ViewModel for the local AI install wizard (C-467). Manages hardware
// detection, model recommendation, download progress, and sidecar
// lifecycle through the shared planning core (@aikami/local-ai).
//
// Uses an injected ProbeExecutor so this ViewModel is testable with
// fixture_executor — no real hardware probes in unit tests.
//
// AC-2: Hardware detection produces a plan matching real hardware.
// AC-3: Sidecar starts, is health-checked, and registers as a normal
//       local provider.
// AC-4: Corrupted/interrupted downloads are never mistaken for ready.

import { BaseViewModel, type BaseViewModelInterface, type BaseViewModelOptions } from '@aikami/frontend/services';
import {
  detectHardware,
  loadManifest,
  recommend,
  type HardwareProfile,
  type ModelManifest,
  type ProbeExecutor,
  type StackPlan,
} from '@aikami/local-ai';
import {
  configService,
  getTauriRuntimeInfo,
  sidecarService,
  type SidecarState,
} from '$services';

// ── Types ─────────────────────────────────────────────────────────────

/** Step in the local AI install wizard flow. */
export type WizardStep =
  | 'idle'
  | 'detecting'
  | 'plan'
  | 'downloading'
  | 'starting'
  | 'ready'
  | 'error';

export type LocalAiWizardViewModelInterface = BaseViewModelInterface & {
  /** Current wizard step. */
  readonly step: WizardStep;
  /** Detected hardware profile (null before detection). */
  readonly hardwareProfile: HardwareProfile | null;
  /** Recommended stack plan (null before detection). */
  readonly stackPlan: StackPlan | null;
  /** Sidecar state (mirrored from sidecarService). */
  readonly sidecarState: SidecarState;
  /** Error message to display. */
  readonly errorMessage: string;
  /** Download progress percentage (0–100). */
  readonly downloadProgress: number;
  /** Whether the detected plan is ready to render. */
  readonly showPlan: boolean;
  /** User-facing GPU summary in GB units. */
  readonly gpuSummary: string;
  /** User-facing RAM summary in GB units. */
  readonly ramSummary: string;
  /** User-facing free-disk summary in GB units. */
  readonly diskSummary: string;
  /** Error text with a stable fallback. */
  readonly displayError: string;
  /** Name of the first recommended model (or null). */
  readonly firstModelName: string | null;
  /** Sidecar port when running (or null). */
  readonly sidecarPort: number | null;

  /** Starts hardware detection. */
  startDetection(): Promise<void>;
  /** Starts the download and launch flow. */
  startInstall(): Promise<void>;
  /** Cancels an in-progress download. */
  cancelDownload(): void;
  /** Retries after an error. */
  retry(): void;
  /** Resets the wizard to idle state. */
  reset(): void;
};

type RuntimePlatform = NonNullable<LocalAiWizardViewModelOptions['platform']>;
type RuntimeArch = NonNullable<LocalAiWizardViewModelOptions['arch']>;

type ModelDownloadProgress = {
  readonly file: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
};

type RuntimeInfo = {
  readonly platform: RuntimePlatform;
  readonly arch: RuntimeArch;
};

const detectRuntimePlatform = (): RuntimePlatform => {
  if (typeof navigator === 'undefined') {
    return 'linux';
  }
  const runtime = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (runtime.includes('win')) {
    return 'win32';
  }
  if (runtime.includes('mac')) {
    return 'darwin';
  }
  return 'linux';
};

const detectRuntimeArch = (): RuntimeArch => {
  if (typeof navigator === 'undefined') {
    return 'x64';
  }
  return /arm64|aarch64/.test(`${navigator.platform} ${navigator.userAgent}`.toLowerCase())
    ? 'arm64'
    : 'x64';
};

export type LocalAiWizardViewModelOptions = BaseViewModelOptions & {
  /** Injected probe executor. In production, use createTauriProbeExecutor(). */
  readonly executor: ProbeExecutor;
  /** Platform identifier (defaults to the current platform). */
  readonly platform?: 'linux' | 'darwin' | 'win32';
  /** CPU architecture (defaults to the current architecture). */
  readonly arch?: 'x64' | 'arm64';
};

// ── ViewModel ─────────────────────────────────────────────────────────

class LocalAiWizardViewModel
  extends BaseViewModel<LocalAiWizardViewModelOptions>
  implements LocalAiWizardViewModelInterface
{
  private readonly _executor: ProbeExecutor;
  private _platform: RuntimePlatform | undefined;
  private _arch: RuntimeArch | undefined;
  private _installToken = 0;
  private _manifest: ModelManifest | undefined;

  step = $state<WizardStep>('idle');
  hardwareProfile = $state<HardwareProfile | null>(null);
  stackPlan = $state<StackPlan | null>(null);
  errorMessage = $state('');
  downloadProgress = $state(0);

  constructor(options: LocalAiWizardViewModelOptions) {
    super(options);
    this._executor = options.executor;
    this._platform = options.platform;
    this._arch = options.arch;
  }

  /** Sidecar state (mirrored from sidecarService). */
  get sidecarState(): SidecarState {
    return sidecarService.state;
  }

  get showPlan(): boolean {
    return this.step === 'plan' && this.hardwareProfile !== null && this.stackPlan !== null;
  }

  get gpuSummary(): string {
    const gpu = this.hardwareProfile?.gpu;
    if (!gpu || gpu.vendor === 'none') {
      return 'GPU: Integrated (CPU-only mode)';
    }
    const name = gpu.name ?? gpu.vendor;
    const memory = gpu.vramMb ? `, ${(gpu.vramMb / 1024).toFixed(1)} GB VRAM` : '';
    return `GPU: ${name}${memory}`;
  }

  get ramSummary(): string {
    return `RAM: ${((this.hardwareProfile?.ramMb ?? 0) / 1024).toFixed(0)} GB`;
  }

  get diskSummary(): string {
    const freeBytes = this.hardwareProfile?.freeDiskBytes ?? 0;
    return `Disk: ${(freeBytes / 1024 / 1024 / 1024).toFixed(0)} GB free`;
  }

  get displayError(): string {
    return this.errorMessage || 'An error occurred';
  }

  /** Name of the first recommended model (or null). */
  get firstModelName(): string | null {
    return this.stackPlan?.models[0]?.manifestId ?? null;
  }

  /** Sidecar port when running (or null). */
  get sidecarPort(): number | null {
    const s = sidecarService.state;
    if (s.status === 'running') {
      return s.port;
    }
    return null;
  }

  // ── Detection ────────────────────────────────────────────────────────

  /**
   * Runs hardware detection through the planning core. AC-2.
   * Detection and recommendation work fully offline — no network call
   * (C-467 Success Measures: offline/degraded behavior).
   */
  async startDetection(): Promise<void> {
    if (this.step === 'detecting') {
      return;
    }

    this.step = 'detecting';
    this.errorMessage = '';

    try {
      const runtime = await this._runtimeInfo();
      const profile = await detectHardware({
        executor: this._executor,
        platform: runtime.platform,
        arch: runtime.arch,
      });

      this.hardwareProfile = profile;
      this.debug('startDetection:profile', {
        gpu: profile.gpu.vendor,
        vramMb: profile.gpu.vramMb,
        ramMb: profile.ramMb,
      });

      // Load the model manifest through the ProbeExecutor seam.
      // Falls back to a minimal manifest when the file is unavailable.
      let manifest: ModelManifest;
      try {
        manifest = await loadManifest({
          executor: this._executor,
          path: 'models.manifest.json',
        });
      } catch {
        // No manifest available — create a minimal one for the plan
        manifest = {
          schemaVersion: 1,
          entries: [],
        };
      }
      this._manifest = manifest;

      const plan = await recommend({
        profile,
        modalities: ['text'],
        manifest,
      });

      this.stackPlan = plan;
      this.step = 'plan';
      this.debug('startDetection:plan', { model: plan.models[0]?.manifestId });
    } catch (error) {
      this.error('startDetection:failed', error);
      this.errorMessage = error instanceof Error ? error.message : 'Detection failed';
      this.step = 'error';
    }
  }

  // ── Install ──────────────────────────────────────────────────────────

  /**
   * Starts the install flow: download model → start sidecar → register
   * as local provider. AC-3, AC-4.
   *
   * The download step calls the Rust-side download_model_file command
   * which verifies SHA-256 checksum + size before writing (AC-4: a
   * corrupted/interrupted download is never mistaken for ready).
   */
  async startInstall(): Promise<void> {
    const modelEntry = this.stackPlan?.models[0];
    if (!modelEntry) {
      this.errorMessage = 'No model selected. Please run detection first.';
      this.step = 'error';
      return;
    }

    const installToken = ++this._installToken;
    this.step = 'downloading';
    this.errorMessage = '';
    this.downloadProgress = 0;

    try {
      // Step 1: Download the model via the Rust download_model_file command
      // (Tauri-only — in browser context this will fail gracefully).
      const modelPath = await this._downloadModel(modelEntry);
      if (!this._isInstallCurrent(installToken)) {
        return;
      }

      // Step 2: Start the sidecar with the downloaded model
      this.step = 'starting';
      await sidecarService.start({
        modelPath,
        executor: this._executor,
      });
      if (!this._isInstallCurrent(installToken)) {
        await sidecarService.stop();
        return;
      }

      if (sidecarService.state.status === 'running') {
        // Step 3: Register as a local provider through configService
        await this._registerLocalProvider();
        if (!this._isInstallCurrent(installToken)) {
          return;
        }
        this.step = 'ready';
      } else {
        const reason = sidecarService.state.status === 'error'
          ? sidecarService.state.reason
          : 'Unknown error';
        this.errorMessage = `Failed to start: ${reason}`;
        this.step = 'error';
      }
    } catch (error) {
      if (!this._isInstallCurrent(installToken)) {
        return;
      }
      this.error('startInstall:failed', error);
      this.errorMessage = error instanceof Error ? error.message : 'Install failed';
      this.step = 'error';
    }
  }

  /**
   * Downloads a model file through the Rust download_model_file command.
   * Uses Tauri IPC invoke() which handles SHA-256 verification on the Rust
   * side (AC-4). Falls back gracefully when not in Tauri context.
   */
  private async _downloadModel(modelEntry: StackPlan['models'][number]): Promise<string> {
    // Check if we're in a Tauri webview
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      throw new Error('Local model installation requires the desktop app');
    }

    const manifestEntry = this._manifest?.entries.find((entry) => entry.id === modelEntry.manifestId);
    if (!manifestEntry) {
      throw new Error(`Model metadata is unavailable: ${modelEntry.manifestId}`);
    }
    const url = this._modelDownloadUrl(manifestEntry);

    try {
      // Use Tauri IPC invoke to call the Rust download_model_file command
      const [{ invoke }, { listen }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);
      const unlisten = await listen<ModelDownloadProgress>('model-download-progress', (event) => {
        const progress = event.payload;
        if (
          this.step !== 'downloading' ||
          progress.file !== manifestEntry.targetPath ||
          progress.totalBytes <= 0
        ) {
          return;
        }
        this.downloadProgress = Math.min(
          100,
          Math.round((progress.receivedBytes / progress.totalBytes) * 100),
        );
      });

      let modelPath: string;
      try {
        modelPath = await invoke<string>('download_model_file', {
          url,
          checksum: manifestEntry.sha256,
          fileName: manifestEntry.targetPath,
          expectedSize: manifestEntry.bytes,
        });
      } finally {
        unlisten();
      }
      if (this.step === 'downloading') {
        this.downloadProgress = 100;
      }

      this.debug('_downloadModel:complete', {
        model: modelEntry.manifestId,
        size: modelEntry.bytes,
      });
      return modelPath;
    } catch (error) {
      this.warn('_downloadModel:failed', error);
      throw error;
    }
  }

  /** Cancels download. */
  cancelDownload(): void {
    this._installToken += 1;
    void sidecarService.stop();
    this.downloadProgress = 0;
    this.errorMessage = '';
    this.step = 'plan';
  }

  /** Retries after an error. */
  retry(): void {
    this.errorMessage = '';
    if (this.hardwareProfile) {
      this.step = 'plan';
    } else {
      this.step = 'idle';
    }
  }

  /** Resets the wizard to idle. */
  reset(): void {
    this.step = 'idle';
    this.hardwareProfile = null;
    this.stackPlan = null;
    this.errorMessage = '';
    this.downloadProgress = 0;
    this._installToken += 1;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Registers the running sidecar as a local AiProvider/AiConnection
   * through configService, so it appears in the AI settings provider tree
   * like any other local connection (C-467 AC-3).
   */
  private async _registerLocalProvider(): Promise<void> {
    const port = sidecarService.config.port;
    const baseUrl = `http://${sidecarService.config.host}:${port}`;

    // Check if a llamacpp connection already exists
    const connections = configService.state.connections ?? [];
    const exists = connections.some(
      (c: { provider?: string; capability?: string }) =>
        c.provider === 'llamacpp' && (c.capability ?? 'text') === 'text',
    );

    if (!exists) {
      configService.addConnection({
        name: 'llama.cpp (local)',
        provider: 'llamacpp',
        capability: 'text',
        apiKey: '',
        baseUrl,
        model: this.stackPlan?.models[0]?.manifestId ?? '',
        generationParams: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
        isDefault: connections.length === 0,
        source: 'detected',
      });

      this.debug('_registerLocalProvider:registered', { baseUrl });
    }
    await configService.save();
  }

  private _isInstallCurrent(installToken: number): boolean {
    return installToken === this._installToken;
  }

  private _modelDownloadUrl(manifestEntry: ModelManifest['entries'][number]): string {
    if ('url' in manifestEntry && typeof manifestEntry.url === 'string') {
      return manifestEntry.url;
    }
    if ('repo' in manifestEntry && 'revision' in manifestEntry && 'file' in manifestEntry) {
      return `https://huggingface.co/${manifestEntry.repo}/resolve/${manifestEntry.revision}/${manifestEntry.file}`;
    }
    throw new Error(`Model download URL is unavailable: ${manifestEntry.id}`);
  }

  private async _runtimeInfo(): Promise<RuntimeInfo> {
    if (this._platform && this._arch) {
      return { platform: this._platform, arch: this._arch };
    }

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const runtime = await getTauriRuntimeInfo();
      this._platform = runtime.platform;
      this._arch = runtime.arch;
    }

    this._platform ??= detectRuntimePlatform();
    this._arch ??= detectRuntimeArch();
    return { platform: this._platform, arch: this._arch };
  }
}

// ── Factory ───────────────────────────────────────────────────────────

export const getLocalAiWizardViewModel = (
  options: LocalAiWizardViewModelOptions,
): LocalAiWizardViewModelInterface => LocalAiWizardViewModel.create(options);

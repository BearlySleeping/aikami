// apps/frontend/client/src/lib/services/capability/webgpu_support_service.svelte.ts
//
// Singleton service for the on-device WebGPU capability, and for the player's
// standing decision about the start-menu recommendation that follows from it.
//
// Why a service and not a call in the view: the answer is expensive-ish to
// obtain (it races an adapter request against a timeout), it is needed by more
// than one surface over a session (the start menu, and any settings surface
// that wants to explain local-model performance), and the dismissal has to
// outlive the view that recorded it — the start menu is the first screen on
// every launch, so an in-memory "dismissed" flag would come back on the next
// boot and read as the game ignoring the player. There is deliberately no
// "un-dismiss": a refusal that comes back on the next launch is the exact
// thing the flag exists to prevent, and clearing the stored key remains the
// escape hatch for anyone who wants the advisory back.
//
// It owns NO adapter probe logic. `isWebGPUSupported` in
// `@aikami/frontend/utils` is the single source of truth shared with the
// Kokoro TTS worker and the local text LLM worker; this service only caches
// the answer and owns the dismissal.

import {
  WEBGPU_COMPATIBILITY_CHECK_URL,
  WEBGPU_RECOMMENDATION_DISMISSED_STORAGE_KEY,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { isWebGPUSupported } from '@aikami/frontend/utils/browser/webgpu';
import type { WebGpuSupportStatus } from '@aikami/types';

export type WebGpuSupportServiceOptions = BaseFrontendClassOptions;

export type WebGpuSupportServiceInterface = BaseFrontendClassInterface & {
  /** The last probe result. `unknown` until the first probe completes. */
  readonly status: WebGpuSupportStatus;

  /** Whether a probe has already run in this session. */
  readonly isChecked: boolean;

  /**
   * Whether the start menu should be recommending WebGPU right now.
   *
   * Requires all three: the probe finished, it came back negative, and the
   * player has not dismissed the recommendation.
   */
  readonly shouldRecommend: boolean;

  /** Whether the player dismissed the recommendation on this device. */
  readonly isRecommendationDismissed: boolean;

  /** The public compatibility checker to send the player to. */
  readonly compatibilityCheckUrl: string;

  /**
   * Probes WebGPU unless a probe already ran this session.
   *
   * Concurrent callers share one in-flight request — the probe has a 3s
   * timeout and a start menu plus a settings screen can both ask in the same
   * tick.
   */
  check(): Promise<WebGpuSupportStatus>;

  /** Records that the player does not want to hear about WebGPU again. */
  dismissRecommendation(): void;
};

class WebGpuSupportService
  extends BaseFrontendClass<WebGpuSupportServiceOptions>
  implements WebGpuSupportServiceInterface
{
  /** The last probe result — `unknown` until the first probe completes. */
  status = $state<WebGpuSupportStatus>('unknown');

  /** Whether the player dismissed the recommendation on this device. */
  isRecommendationDismissed = $state<boolean>(false);

  /**
   * The in-flight probe, shared by concurrent callers.
   *
   * Held as a promise rather than a boolean "probing" flag so a second
   * `check()` awaits the first result instead of starting a second adapter
   * request for an answer that cannot differ.
   */
  private _inFlight: Promise<WebGpuSupportStatus> | undefined;

  constructor(options: WebGpuSupportServiceOptions) {
    super(options);
    // 🔴 Restore at construction, NOT only in an explicit `initialize()`:
    // the start menu is reachable through more than one entry point, and a
    // dismissal read only during initialization would flash the banner for a
    // frame on a device that had already dismissed it.
    this._restore();
  }

  /** @inheritdoc */
  get isChecked(): boolean {
    return this.status !== 'unknown';
  }

  /** @inheritdoc */
  get shouldRecommend(): boolean {
    return this.status === 'unsupported' && !this.isRecommendationDismissed;
  }

  /** @inheritdoc */
  get compatibilityCheckUrl(): string {
    return WEBGPU_COMPATIBILITY_CHECK_URL;
  }

  /** @inheritdoc */
  async check(): Promise<WebGpuSupportStatus> {
    if (this.isChecked) {
      return this.status;
    }
    return this._probe();
  }

  /** @inheritdoc */
  dismissRecommendation(): void {
    this.isRecommendationDismissed = true;
    try {
      localStorage.setItem(WEBGPU_RECOMMENDATION_DISMISSED_STORAGE_KEY, '1');
    } catch {
      // Storage unavailable (private mode / quota) — in-memory only, so the
      // banner stays gone for this session and may return on the next one.
      this.warn('dismissRecommendation:storage-unavailable');
    }
    this.debug('dismissRecommendation');
  }

  /**
   * Runs the probe, collapsing concurrent callers onto one request.
   *
   * The probe itself never rejects (`isWebGPUSupported` answers `false` on
   * any failure), so the shared promise needs no error branch here.
   */
  private async _probe(): Promise<WebGpuSupportStatus> {
    this._inFlight ??= isWebGPUSupported()
      .then((supported) => {
        this.status = supported ? 'supported' : 'unsupported';
        return this.status;
      })
      .finally(() => {
        this._inFlight = undefined;
      });

    return this._inFlight;
  }

  /** Reads the persisted dismissal, defaulting to "not dismissed". */
  private _restore(): void {
    try {
      this.isRecommendationDismissed =
        localStorage.getItem(WEBGPU_RECOMMENDATION_DISMISSED_STORAGE_KEY) === '1';
    } catch {
      this.isRecommendationDismissed = false;
    }
  }
}

export const webGpuSupportService: WebGpuSupportServiceInterface = WebGpuSupportService.create({
  className: 'WebGpuSupportService',
});

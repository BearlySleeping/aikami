// apps/frontend/hub/src/lib/views/studio_assets/studio_assets_types.ts
//
// C-522 — the Hub Studio → Generation ViewModel's type surface.
//
// Extracted so the ViewModel stays inside the source-size budget and the View
// and tests import through one module (the `map_studio_types.ts` pattern). No
// runtime code lives here.

import type { BaseViewModelInterface, BaseViewModelOptions } from '@aikami/frontend/services';
import type { GenerationDispatch, GenerationRunnerAvailability } from '@aikami/schemas';
import type { RunnerDeviceSummary } from '@aikami/types';
import type {
  GenerationArtifact,
  GenerationCandidate,
  GenerationRunnerClientInterface,
  RunnerPairingCode,
} from '$lib/client/services/generation_runner_client.ts';

/** One dispatch as the review surface renders it, with its artifacts. */
export type DispatchReviewRow = {
  readonly dispatch: GenerationDispatch;
  readonly artifacts: readonly GenerationArtifact[];
};

export type HubStudioAssetsViewModelOptions = BaseViewModelOptions & {
  /** Whether the visitor has a session; without one the surface is read-only. */
  readonly signedIn: boolean;
  /** Whether this deployment has a D1 binding for the runner surface. */
  readonly configured: boolean;
  /** Server-loaded devices, so the first paint needs no round-trip. */
  readonly devices: readonly RunnerDeviceSummary[];
  /** Injected by the page; tests supply a double with no network. */
  readonly client: GenerationRunnerClientInterface;
};

export type HubStudioAssetsViewModelInterface = BaseViewModelInterface & {
  readonly signedIn: boolean;
  readonly configured: boolean;
  readonly devices: readonly RunnerDeviceSummary[];
  readonly dispatches: readonly DispatchReviewRow[];
  readonly candidates: readonly GenerationCandidate[];
  readonly availability: GenerationRunnerAvailability | undefined;
  readonly pairingCode: RunnerPairingCode | undefined;
  readonly busy: boolean;
  /**
   * Named `failureMessage`, not `error`: `BaseViewModel` already owns an
   * `error(...)` logging method, and shadowing it would break `create()`.
   */
  readonly failureMessage: string | undefined;
  /**
   * The polite live region's text. Every action writes here, so a screen
   * reader hears "Pairing code ABCD-… created" or "Dispatch cancelled
   * (not confirmed by the runner)" instead of silence.
   */
  readonly statusMessage: string;
  /** True while a refresh is in flight, for the "Refreshing…" affordance. */
  readonly refreshing: boolean;
  refresh(): Promise<void>;
  createPairingCode(): Promise<void>;
  revokeRunner(deviceId: string): Promise<void>;
  setArtifactUpload(deviceId: string, enabled: boolean): Promise<void>;
  cancelDispatch(dispatchId: string): Promise<void>;
  reviewCandidate(candidateId: string, decision: 'accept' | 'reject'): Promise<void>;
  /** The retrieval path for an uploaded image artifact, or undefined. */
  imageSourceFor(artifact: GenerationArtifact): string | undefined;
  /** A dispatch's status as prose, for the list. */
  statusLabel(dispatch: GenerationDispatch): string;
  /** The private candidates belonging to one dispatch. */
  candidatesFor(dispatchId: string): readonly GenerationCandidate[];
  /** Whether a dispatch is still running (and therefore cancellable). */
  isCancellable(dispatch: GenerationDispatch): boolean;
};

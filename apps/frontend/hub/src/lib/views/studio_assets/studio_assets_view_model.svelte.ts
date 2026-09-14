// apps/frontend/hub/src/lib/views/studio_assets/studio_assets_view_model.svelte.ts
//
// C-522 — Hub Studio → Generation ViewModel.
//
// The Hub is where a creator pairs a machine, dispatches a job to it and
// reviews the private result. This ViewModel owns that state and nothing else:
// every network call goes through the injected client, and the View stays
// logicless (no `$effect`, no fetch) per the MVVM conventions.
//
// Two things it deliberately does NOT do:
//   * it never publishes. Accepting a candidate is a private decision; the
//     public namespace is only reachable through the explicit publishing flow.
//   * it never claims a stop it did not observe. A cancel request is announced
//     as a *request* until the runner confirms it.
//
// Contract: C-522 Hub and client access to the generation runner

import { BaseViewModel } from '@aikami/frontend/services';
import type { GenerationDispatch, GenerationRunnerAvailability } from '@aikami/schemas';
import type { RunnerDeviceSummary } from '@aikami/types';
import type {
  GenerationArtifact,
  GenerationCandidate,
  GenerationRunnerClientInterface,
  RunnerPairingCode,
} from '$lib/client/services/generation_runner_client.ts';
import type { DispatchReviewRow } from './studio_assets_types.ts';

// Re-exported as explicit aliases (not `export ... from`) so the MVVM guard
// sees the `export type XxxViewModelOptions =` declaration form.
export type HubStudioAssetsViewModelOptions =
  import('./studio_assets_types.ts').HubStudioAssetsViewModelOptions;
export type HubStudioAssetsViewModelInterface =
  import('./studio_assets_types.ts').HubStudioAssetsViewModelInterface;
export type { DispatchReviewRow };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** How long a minted pairing code is valid, for the countdown copy. */
const codeExpiryLabel = (expiresAt: string): string => {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(remainingMs) || remainingMs <= 0) {
    return 'expired';
  }
  return `valid for about ${Math.max(1, Math.round(remainingMs / 60_000))} minute(s)`;
};

/** `generating` / `awaiting review` / `failed` — the status as prose. */
const statusLabel = (dispatch: GenerationDispatch): string => dispatch.status.replace(/_/g, ' ');

export class HubStudioAssetsViewModel
  extends BaseViewModel<HubStudioAssetsViewModelOptions>
  implements HubStudioAssetsViewModelInterface
{
  signedIn = $state(false);
  configured = $state(false);
  devices = $state<RunnerDeviceSummary[]>([]);
  dispatches = $state<DispatchReviewRow[]>([]);
  candidates = $state<GenerationCandidate[]>([]);
  availability = $state<GenerationRunnerAvailability | undefined>(undefined);
  pairingCode = $state<RunnerPairingCode | undefined>(undefined);
  busy = $state(false);
  refreshing = $state(false);
  failureMessage = $state<string | undefined>(undefined);
  statusMessage = $state('');

  private readonly _client: GenerationRunnerClientInterface;

  constructor(options: HubStudioAssetsViewModelOptions) {
    super(options);
    this.signedIn = options.signedIn;
    this.configured = options.configured;
    this.devices = [...options.devices];
    this._client = options.client;
  }

  /** Re-read everything the surface shows. Never throws — it reports. */
  async refresh(): Promise<void> {
    if (!this.signedIn || !this.configured) {
      return;
    }
    this.refreshing = true;
    try {
      const [devices, dispatchList, candidateList, availability] = await Promise.all([
        this._client.listRunners(),
        this._client.listDispatches(),
        this._client.listCandidates(),
        this._client.availability(),
      ]);
      this.devices = devices;
      this.candidates = candidateList;
      this.availability = availability;
      this.dispatches = await this._loadArtifacts(dispatchList);
      this.failureMessage = undefined;
    } catch (cause) {
      this.failureMessage = errorMessage(cause);
    } finally {
      this.refreshing = false;
    }
  }

  /** Artifacts are fetched per dispatch; a failure degrades to "no preview". */
  async _loadArtifacts(dispatchList: readonly GenerationDispatch[]): Promise<DispatchReviewRow[]> {
    const rows: DispatchReviewRow[] = [];
    for (const dispatch of dispatchList) {
      let artifacts: readonly GenerationArtifact[] = [];
      try {
        artifacts = await this._client.listArtifacts(dispatch.dispatchId);
      } catch {
        // A dispatch whose artifacts cannot be listed still belongs on screen:
        // its status is the actionable part.
      }
      rows.push({ dispatch, artifacts });
    }
    return rows;
  }

  /**
   * Mint a short-lived pairing code and announce the exact command.
   *
   * The command is what the creator types, so it is copied verbatim from the
   * API response rather than re-derived here — the docs and the tool cannot
   * drift apart if there is only one place the string exists.
   */
  async createPairingCode(): Promise<void> {
    this.busy = true;
    try {
      this.pairingCode = await this._client.createPairingCode();
      this.statusMessage = `Pairing code ${this.pairingCode.code} created — ${codeExpiryLabel(this.pairingCode.expiresAt)}.`;
      this.failureMessage = undefined;
    } catch (cause) {
      this.failureMessage = errorMessage(cause);
      this.statusMessage = 'Could not create a pairing code.';
    } finally {
      this.busy = false;
    }
  }

  async revokeRunner(deviceId: string): Promise<void> {
    this.busy = true;
    try {
      await this._client.revokeRunner(deviceId);
      this.devices = this.devices.map((device) =>
        device.deviceId === deviceId ? { ...device, revoked: true, online: false } : device,
      );
      // Stated precisely: revocation blocks new work; it never deletes a local
      // result, and the surface must not imply otherwise.
      this.statusMessage = `${deviceId} revoked. It cannot claim new jobs or share results; anything already generated on it is untouched.`;
      this.failureMessage = undefined;
    } catch (cause) {
      this.failureMessage = errorMessage(cause);
    } finally {
      this.busy = false;
    }
  }

  async setArtifactUpload(deviceId: string, enabled: boolean): Promise<void> {
    this.busy = true;
    try {
      const updated = await this._client.setArtifactUpload(deviceId, enabled);
      this.devices = this.devices.map((device) =>
        device.deviceId === deviceId ? updated : device,
      );
      this.statusMessage = enabled
        ? `Private preview upload enabled for ${deviceId}.`
        : `Private preview upload disabled for ${deviceId} — results stay local-only.`;
      this.failureMessage = undefined;
    } catch (cause) {
      this.failureMessage = errorMessage(cause);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Ask the runner to stop, and say exactly what that did.
   *
   * The Hub records a *request*; the provider's own receipt is a separate fact
   * the runner reports later. Announcing "cancelled" here would be a lie about
   * a GPU that may still be running.
   */
  async cancelDispatch(dispatchId: string): Promise<void> {
    this.busy = true;
    try {
      const cancellation = await this._client.requestCancel(dispatchId);
      this.statusMessage = cancellation.confirmed
        ? 'Cancellation confirmed by the runner.'
        : 'Cancellation requested. The runner reports whether it could stop the engine.';
      this.failureMessage = undefined;
    } catch (cause) {
      this.failureMessage = errorMessage(cause);
      this.statusMessage = 'Cancellation was refused.';
    } finally {
      this.busy = false;
    }
  }

  /**
   * Accept or reject a candidate — privately.
   *
   * The announcement says "not published" out loud, because the distinction
   * between accepting a result and publishing it is the one a creator is most
   * likely to get wrong.
   */
  async reviewCandidate(candidateId: string, decision: 'accept' | 'reject'): Promise<void> {
    this.busy = true;
    try {
      await this._client.reviewCandidate(candidateId, decision);
      this.candidates = this.candidates.map((candidate) =>
        candidate.candidateId === candidateId
          ? { ...candidate, status: decision === 'accept' ? 'accepted' : 'rejected' }
          : candidate,
      );
      this.statusMessage =
        decision === 'accept'
          ? 'Candidate accepted for local use. It is not published — publishing is a separate step.'
          : 'Candidate rejected. Nothing was deleted.';
      this.failureMessage = undefined;
    } catch (cause) {
      this.failureMessage = errorMessage(cause);
    } finally {
      this.busy = false;
    }
  }

  /**
   * The stated outcome for a finished job whose bytes never reached the Hub.
   *
   * Private-preview upload is off by default, so *no artifact ticket exists at
   * all* — there is nothing to list. Without this, a completed local-only job
   * renders as a bare status line and the creator is left guessing where their
   * result is. The statement names the machine that holds the bytes and the
   * switch that would change it, which is the honest half of AC-6.
   */
  localOnlyStatement(dispatchId: string): string | undefined {
    const row = this.dispatches.find((entry) => entry.dispatch.dispatchId === dispatchId);
    if (!row) {
      return undefined;
    }
    const finished =
      row.dispatch.status === 'awaiting_review' || row.dispatch.status === 'succeeded';
    if (!finished || row.artifacts.length > 0) {
      return undefined;
    }
    return 'This result exists only on the paired machine — private preview upload is off for this device. Export it from the runner, or enable Preview upload and generate again.';
  }

  /** Only an uploaded, unexpired image artifact has a retrievable source. */
  imageSourceFor(artifact: GenerationArtifact): string | undefined {
    if (artifact.kind !== 'image' || !artifact.uploaded || artifact.expired) {
      return undefined;
    }
    return artifact.retrievalPath;
  }

  /** A dispatch's human-readable status, for the list. */
  statusLabel(dispatch: GenerationDispatch): string {
    return statusLabel(dispatch);
  }

  /** The candidate rows belonging to one dispatch, oldest first. */
  candidatesFor(dispatchId: string): readonly GenerationCandidate[] {
    return this.candidates.filter((candidate) => candidate.dispatchId === dispatchId);
  }

  /** Whether a dispatch is still running (and therefore cancellable). */
  isCancellable(dispatch: GenerationDispatch): boolean {
    return (
      dispatch.status !== 'succeeded' &&
      dispatch.status !== 'failed' &&
      dispatch.status !== 'cancelled' &&
      dispatch.status !== 'interrupted' &&
      dispatch.status !== 'awaiting_review' &&
      dispatch.status !== 'reconciliation_required'
    );
  }
}

/**
 * Builds the ViewModel. Kept as a factory (not a singleton) so each page load
 * gets fresh state and tests can inject a client double.
 */
export const createHubStudioAssetsViewModel = (
  options: HubStudioAssetsViewModelOptions,
): HubStudioAssetsViewModelInterface =>
  HubStudioAssetsViewModel.create({ ...options, className: 'HubStudioAssetsViewModel' });

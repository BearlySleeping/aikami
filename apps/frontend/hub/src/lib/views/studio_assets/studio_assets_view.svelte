<script lang="ts">
// apps/frontend/hub/src/lib/views/studio_assets/studio_assets_view.svelte
// C-522 — Hub Studio → Generation: pairing, dispatch status and private review.
//
// The View is logicless (Pillar 3): it binds to the ViewModel and reports what
// the ViewModel computed. Accessibility is load-bearing here (AC-6): a single
// polite live region announces every state change, every control is a real
// button or labelled input, and a private preview is described in text as well
// as shown.

import { BaseViewModelContainer, Image } from '$components';
import type { HubStudioAssetsViewModelInterface } from './studio_assets_view_model.svelte.ts';

type Props = { viewModel: HubStudioAssetsViewModelInterface };
let { viewModel }: Props = $props();
</script>

<BaseViewModelContainer
  {viewModel}
  id="studio-assets"
  element="section"
  class="flex max-w-[60rem] flex-col gap-3 p-6"
  aria-labelledby="studio-assets-heading"
>
  <h1 id="studio-assets-heading" class="text-2xl font-bold">Generation studio</h1>
  <p class="opacity-[0.85]">
    Pair a machine, dispatch an asset job to it, and review the private result here. Accepting a
    result keeps it private until you publish it deliberately.
  </p>

  <!-- One polite live region for the whole surface: every action announces its
       outcome once, rather than each control shouting over the others. -->
  <!-- `role="status"` already carries a polite live region; adding aria-live
       as well would announce every change twice on some screen readers. -->
  <p class="min-h-[1.5rem]" role="status" data-testid="status-message">
    {viewModel.statusMessage}
  </p>

  {#if viewModel.failureMessage}
    <p class="text-error" role="alert" data-testid="error-message">{viewModel.failureMessage}</p>
  {/if}

  {#if !viewModel.configured}
    <p class="opacity-[0.85]" data-testid="unconfigured">
      This deployment has no generation store configured. Local generation in the editor is
      unaffected.
    </p>
  {:else if !viewModel.signedIn}
    <p class="opacity-[0.85]" data-testid="signed-out">
      Sign in to pair a machine and dispatch jobs. Generating locally in the editor needs no
      account.
    </p>
  {:else}
    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onclick={() => viewModel.createPairingCode()}
        disabled={viewModel.busy || viewModel.refreshing}
        data-testid="create-pairing-code"
      >
        Create pairing code
      </button>
      <button
        type="button"
        onclick={() => viewModel.refresh()}
        disabled={viewModel.refreshing || viewModel.busy}
        aria-describedby="refresh-hint"
        data-testid="refresh"
      >
        Refresh status
      </button>
      <span id="refresh-hint" class="text-sm opacity-75">
        Re-reads paired devices, dispatches and pending review results.
      </span>
    </div>

    {#if viewModel.pairingCode}
      <div data-testid="pairing-code">
        <h2>Pair a machine</h2>
        <p>
          Code <code class="text-[1.1em] tracking-[0.08em]">{viewModel.pairingCode.code}</code> —
          run this on the machine that owns the GPU:
        </p>
        <figure>
          <figcaption>Pairing command</figcaption>
          <pre
            class="overflow-x-auto rounded bg-base-300/30 p-3"
          >{viewModel.pairingCode.command}</pre>
        </figure>
      </div>
    {/if}

    <h2>Availability</h2>
    {#if viewModel.availability?.available}
      <p data-testid="availability">
        Ready — using
        {viewModel.availability.mode === 'paired_outbound'
          ? 'a paired runner'
          : 'a direct local engine'}.
      </p>
    {:else if viewModel.availability}
      <div data-testid="availability">
        <p><strong>Generation is unavailable.</strong> {viewModel.availability.reason}</p>
        <p class="text-sm opacity-75">{viewModel.availability.remedy}</p>
      </div>
    {/if}

    <h2>Paired devices</h2>
    {#if viewModel.devices.length === 0}
      <p data-testid="no-devices">No machine is paired to this account yet.</p>
    {:else}
      <ul class="flex list-none flex-col gap-3 p-0" data-testid="device-list">
        {#each viewModel.devices as device (device.deviceId)}
          <li class="rounded-lg border border-base-300 p-3">
            <span>{device.label}</span>
            <span class="ml-2 opacity-75">
              {device.platform}
              · {device.modalities.join(', ') || 'no modalities'} ·
              {device.online ? 'online' : 'offline'}{device.revoked ? ' · revoked' : ''}
            </span>
            <span class="ml-2 inline-flex gap-2">
              <button
                type="button"
                onclick={() => viewModel.setArtifactUpload(device.deviceId, !device.artifactUploadEnabled)}
                disabled={viewModel.busy || viewModel.refreshing || device.revoked}
                aria-label={`${device.artifactUploadEnabled ? 'Disable' : 'Enable'} private preview upload for ${device.label}`}
              >
                {device.artifactUploadEnabled ? 'Preview upload on' : 'Preview upload off'}
              </button>
              <button
                type="button"
                onclick={() => viewModel.revokeRunner(device.deviceId)}
                disabled={viewModel.busy || viewModel.refreshing || device.revoked}
                aria-label={`Revoke ${device.label}`}
              >
                Revoke
              </button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Dispatches</h2>
    {#if viewModel.dispatches.length === 0}
      <p data-testid="no-dispatches">Nothing has been dispatched yet.</p>
    {:else}
      <ul class="flex list-none flex-col gap-3 p-0" data-testid="dispatch-list">
        {#each viewModel.dispatches as row (row.dispatch.dispatchId)}
          <li class="rounded-lg border border-base-300 p-3">
            <p>
              <span>{row.dispatch.jobId}</span>
              <span>{viewModel.statusLabel(row.dispatch)}</span>
              <span class="ml-2 opacity-75">attempt {row.dispatch.attempt}</span>
            </p>
            {#if row.dispatch.failure}
              <p class="text-error" role="alert">
                {row.dispatch.failure.code}: {row.dispatch.failure.message}
              </p>
            {/if}
            {#if row.dispatch.cancellation?.requested}
              <p class="text-sm opacity-75">
                Cancellation requested{row.dispatch.cancellation.confirmed
                  ? ' and confirmed by the runner.'
                  : ' — the runner has not confirmed the engine stopped.'}
              </p>
            {/if}
            {#if viewModel.isCancellable(row.dispatch)}
              <button
                type="button"
                onclick={() => viewModel.cancelDispatch(row.dispatch.dispatchId)}
                disabled={viewModel.busy || viewModel.refreshing}
                aria-label={`Cancel ${row.dispatch.jobId}`}
              >
                Cancel
              </button>
            {/if}

            {#if viewModel.artifactsErrorFor(row.dispatch.dispatchId)}
              <p class="text-error" role="alert" data-testid="artifact-error">
                {viewModel.artifactsErrorFor(row.dispatch.dispatchId)}
              </p>
            {/if}

            {#if viewModel.localOnlyStatement(row.dispatch.dispatchId)}
              <p class="text-sm opacity-75" data-testid="local-only-result">
                {viewModel.localOnlyStatement(row.dispatch.dispatchId)}
              </p>
            {/if}

            {#each row.artifacts as artifact (artifact.ticketId)}
              <div>
                {#if viewModel.imageSourceFor(artifact)}
                  <Image
                    src={viewModel.imageSourceFor(artifact)}
                    alt={`Private preview for ${row.dispatch.jobId}, candidate ${artifact.candidateId}`}
                    class="h-auto max-w-[16rem] rounded-md"
                  />
                {:else if viewModel.audioSourceFor(artifact)}
                  <!-- biome-ignore lint/a11y/useMediaCaption: this is a private
                       generated candidate, not dialogue or narration — there is
                       no caption track to attach. -->
                  <audio
                    controls
                    src={viewModel.audioSourceFor(artifact)}
                    aria-label={`Private audio preview for ${row.dispatch.jobId}`}
                  ></audio>
                {:else}
                  <p class="text-sm opacity-75">
                    Local-only result — private preview upload is off for this device, or the
                    artifact has expired. Export it from the runner instead.
                  </p>
                {/if}
              </div>
            {/each}

            {#each viewModel.candidatesFor(row.dispatch.dispatchId) as candidate (candidate.candidateId)}
              <div class="flex flex-wrap items-center gap-2">
                <p>
                  Candidate <code>{candidate.candidateId.slice(0, 8)}</code> —
                  {candidate.status}
                  · seed {candidate.seed}
                </p>
                <button
                  type="button"
                  onclick={() => viewModel.reviewCandidate(candidate.candidateId, 'accept')}
                  disabled={viewModel.busy || viewModel.refreshing}
                  aria-label={`Accept candidate ${candidate.candidateId.slice(0, 8)} for local use`}
                >
                  Accept (keeps it private)
                </button>
                <button
                  type="button"
                  onclick={() => viewModel.reviewCandidate(candidate.candidateId, 'reject')}
                  disabled={viewModel.busy || viewModel.refreshing}
                  aria-label={`Reject candidate ${candidate.candidateId.slice(0, 8)}`}
                >
                  Reject
                </button>
              </div>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</BaseViewModelContainer>

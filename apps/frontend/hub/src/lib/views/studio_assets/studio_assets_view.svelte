<script lang="ts">
// apps/frontend/hub/src/lib/views/studio_assets/studio_assets_view.svelte
// C-522 — Hub Studio → Generation: pairing, dispatch status and private review.
//
// The View is logicless (Pillar 3): it binds to the ViewModel and reports what
// the ViewModel computed. Accessibility is load-bearing here (AC-6): a single
// polite live region announces every state change, every control is a real
// button or labelled input, and a private preview is described in text as well
// as shown.

import type { HubStudioAssetsViewModelInterface } from './studio_assets_view_model.svelte.ts';

let { viewModel }: { viewModel: HubStudioAssetsViewModelInterface } = $props();
</script>

<section class="studio-assets" aria-labelledby="studio-assets-heading">
  <h1 id="studio-assets-heading">Generation studio</h1>
  <p class="lede">
    Pair a machine, dispatch an asset job to it, and review the private result here. Accepting a
    result keeps it private until you publish it deliberately.
  </p>

  <!-- One polite live region for the whole surface: every action announces its
       outcome once, rather than each control shouting over the others. -->
  <!-- `role="status"` already carries a polite live region; adding aria-live
       as well would announce every change twice on some screen readers. -->
  <p class="status" role="status" data-testid="status-message">
    {viewModel.statusMessage}
  </p>

  {#if viewModel.failureMessage}
    <p class="error" role="alert" data-testid="error-message">{viewModel.failureMessage}</p>
  {/if}

  {#if !viewModel.configured}
    <p class="notice" data-testid="unconfigured">
      This deployment has no generation store configured. Local generation in the editor is
      unaffected.
    </p>
  {:else if !viewModel.signedIn}
    <p class="notice" data-testid="signed-out">
      Sign in to pair a machine and dispatch jobs. Generating locally in the editor needs no
      account.
    </p>
  {:else}
    <div class="actions">
      <button
        type="button"
        onclick={() => viewModel.createPairingCode()}
        disabled={viewModel.busy}
        data-testid="create-pairing-code"
      >
        Create pairing code
      </button>
      <button
        type="button"
        onclick={() => viewModel.refresh()}
        disabled={viewModel.refreshing}
        aria-describedby="refresh-hint"
        data-testid="refresh"
      >
        Refresh status
      </button>
      <span id="refresh-hint" class="hint">
        Re-reads paired devices, dispatches and pending review results.
      </span>
    </div>

    {#if viewModel.pairingCode}
      <div class="pairing" data-testid="pairing-code">
        <h2>Pair a machine</h2>
        <p>
          Code <code class="code">{viewModel.pairingCode.code}</code> — run this on the machine that
          owns the GPU:
        </p>
        <figure>
          <figcaption>Pairing command</figcaption>
          <pre class="command">{viewModel.pairingCode.command}</pre>
        </figure>
      </div>
    {/if}

    <h2>Availability</h2>
    {#if viewModel.availability?.available}
      <p class="available" data-testid="availability">
        Ready — using
        {viewModel.availability.mode === 'paired_outbound'
          ? 'a paired runner'
          : 'a direct local engine'}.
      </p>
    {:else if viewModel.availability}
      <div class="unavailable" data-testid="availability">
        <p><strong>Generation is unavailable.</strong> {viewModel.availability.reason}</p>
        <p class="hint">{viewModel.availability.remedy}</p>
      </div>
    {/if}

    <h2>Paired devices</h2>
    {#if viewModel.devices.length === 0}
      <p data-testid="no-devices">No machine is paired to this account yet.</p>
    {:else}
      <ul class="devices" data-testid="device-list">
        {#each viewModel.devices as device (device.deviceId)}
          <li>
            <span class="device-label">{device.label}</span>
            <span class="device-meta">
              {device.platform}
              · {device.modalities.join(', ') || 'no modalities'} ·
              {device.online ? 'online' : 'offline'}{device.revoked ? ' · revoked' : ''}
            </span>
            <span class="device-controls">
              <button
                type="button"
                onclick={() => viewModel.setArtifactUpload(device.deviceId, !device.artifactUploadEnabled)}
                disabled={viewModel.busy || device.revoked}
                aria-label={`${device.artifactUploadEnabled ? 'Disable' : 'Enable'} private preview upload for ${device.label}`}
              >
                {device.artifactUploadEnabled ? 'Preview upload on' : 'Preview upload off'}
              </button>
              <button
                type="button"
                onclick={() => viewModel.revokeRunner(device.deviceId)}
                disabled={viewModel.busy || device.revoked}
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
      <ul class="dispatches" data-testid="dispatch-list">
        {#each viewModel.dispatches as row (row.dispatch.dispatchId)}
          <li>
            <p class="dispatch-head">
              <span class="job-id">{row.dispatch.jobId}</span>
              <span class="dispatch-status">{viewModel.statusLabel(row.dispatch)}</span>
              <span class="dispatch-attempt">attempt {row.dispatch.attempt}</span>
            </p>
            {#if row.dispatch.failure}
              <p class="error" role="alert">
                {row.dispatch.failure.code}: {row.dispatch.failure.message}
              </p>
            {/if}
            {#if row.dispatch.cancellation?.requested}
              <p class="hint">
                Cancellation requested{row.dispatch.cancellation.confirmed
                  ? ' and confirmed by the runner.'
                  : ' — the runner has not confirmed the engine stopped.'}
              </p>
            {/if}
            {#if viewModel.isCancellable(row.dispatch)}
              <button
                type="button"
                onclick={() => viewModel.cancelDispatch(row.dispatch.dispatchId)}
                disabled={viewModel.busy}
                aria-label={`Cancel ${row.dispatch.jobId}`}
              >
                Cancel
              </button>
            {/if}

            {#each row.artifacts as artifact (artifact.ticketId)}
              <div class="artifact">
                {#if viewModel.imageSourceFor(artifact)}
                  <img
                    src={viewModel.imageSourceFor(artifact)}
                    alt={`Private preview for ${row.dispatch.jobId}, candidate ${artifact.candidateId}`}
                  >
                {:else if artifact.kind === 'audio' && artifact.uploaded && !artifact.expired}
                  <!-- biome-ignore lint/a11y/useMediaCaption: this is a private
                       generated candidate, not dialogue or narration — there is
                       no caption track to attach. -->
                  <audio
                    controls
                    src={artifact.retrievalPath}
                    aria-label={`Private audio preview for ${row.dispatch.jobId}`}
                  ></audio>
                {:else}
                  <p class="hint">
                    Local-only result — private preview upload is off for this device, or the
                    artifact has expired. Export it from the runner instead.
                  </p>
                {/if}
              </div>
            {/each}

            {#each viewModel.candidatesFor(row.dispatch.dispatchId) as candidate (candidate.candidateId)}
              <div class="candidate">
                <p>
                  Candidate <code>{candidate.candidateId.slice(0, 8)}</code> —
                  {candidate.status}
                  · seed {candidate.seed}
                </p>
                <button
                  type="button"
                  onclick={() => viewModel.reviewCandidate(candidate.candidateId, 'accept')}
                  disabled={viewModel.busy}
                  aria-label={`Accept candidate ${candidate.candidateId.slice(0, 8)} for local use`}
                >
                  Accept (keeps it private)
                </button>
                <button
                  type="button"
                  onclick={() => viewModel.reviewCandidate(candidate.candidateId, 'reject')}
                  disabled={viewModel.busy}
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
</section>

<style>
.studio-assets {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 60rem;
  padding: 1.5rem;
}
.lede {
  opacity: 0.85;
}
.status {
  min-height: 1.5rem;
}
.error {
  color: #f88;
}
.hint {
  opacity: 0.75;
  font-size: 0.875rem;
}
.actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}
.code {
  font-size: 1.1em;
  letter-spacing: 0.08em;
}
.command {
  padding: 0.75rem;
  overflow-x: auto;
  background: rgb(0 0 0 / 30%);
}
ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
li {
  border: 1px solid rgb(255 255 255 / 15%);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
.device-meta,
.dispatch-attempt {
  opacity: 0.75;
  margin-left: 0.5rem;
}
.artifact img {
  max-width: 16rem;
  height: auto;
  border-radius: 0.375rem;
}
.candidate {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
</style>

// apps/frontend/hub/src/lib/views/studio_assets/__tests__/studio_assets_view_model.test.ts
//
// C-522 AC-2/AC-6 (Hub UI surface): the ViewModel's announcements are the
// accessible half of the review journey, so they are asserted directly.
//
// The rule under test: the UI never claims more than the server did. A cancel
// is announced as a *request* until the runner confirms it, and an accepted
// candidate is announced as private, not published.

import { describe, expect, mock, test } from 'bun:test';
import { localProviderProfileForEngine } from '@aikami/constants';
import type { GenerationDispatch } from '@aikami/schemas';
import type { RunnerDeviceSummary } from '@aikami/types';
import type {
  GenerationArtifact,
  GenerationCandidate,
  GenerationRunnerClientInterface,
  RunnerPairingCode,
} from '$lib/client/services/generation_runner_client.ts';
import { createHubStudioAssetsViewModel } from '../studio_assets_view_model.svelte.ts';

const BUDGET = {
  gpuConcurrency: 1,
  candidateLimitPerItem: 1,
  maxCandidatesPerRun: 1,
  hostedBudgetUsd: 0,
  maxDurationSeconds: 0,
  maxPixels: 1_048_576,
  maxRetainedBytes: 8_388_608,
  maxRequestedAudioSecondsPerCandidatePass: 0,
};

const device = (overrides: Partial<RunnerDeviceSummary> = {}): RunnerDeviceSummary => ({
  schemaVersion: 1,
  deviceId: 'dev_1',
  label: 'Studio desktop',
  platform: 'linux',
  modalities: ['image'],
  resourceGroups: ['gpu:0'],
  artifactUploadEnabled: false,
  createdAt: '2026-09-14T00:00:00.000Z',
  lastSeenAt: '2026-09-14T00:00:00.000Z',
  revoked: false,
  online: true,
  ...overrides,
});

/**
 * 🔴 A profile the registry actually declares, resolved rather than written
 * down. The fixture used to name `local-sdcpp`, which is in no registry.
 *
 * Asserted rather than defaulted: an empty-string fallback silently invents an
 * id, which is the defect this fixture exists to catch.
 */
const STUDIO_PROFILE = localProviderProfileForEngine({ engineId: 'sdcpp', modality: 'image' });
if (STUDIO_PROFILE === undefined) {
  throw new Error('the registry declares no local sdcpp image provider profile');
}
const STUDIO_PROFILE_ID = STUDIO_PROFILE.id;

const dispatch = (overrides: Partial<GenerationDispatch> = {}): GenerationDispatch => ({
  schemaVersion: 1,
  dispatchId: 'dispatch-1',
  ownerAccountId: 'acct-1',
  deviceId: 'dev_1',
  jobId: 'job-1',
  requestKey: 'job-1:k',
  effectiveSpecHash: 'a'.repeat(64),
  attempt: 1,
  spec: {
    itemId: 'item-1',
    recipeId: 'portrait',
    modality: 'image',
    providerProfileId: STUDIO_PROFILE_ID,
    preparationProfile: 'portrait',
    referenceIds: [],
    seed: 1,
    candidateLimit: 1,
    budget: BUDGET,
    prompt: 'x',
  },
  status: 'running',
  candidateCount: 0,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
});

const candidate = (overrides: Partial<GenerationCandidate> = {}): GenerationCandidate => ({
  schemaVersion: 1,
  candidateId: 'candidate-1',
  dispatchId: 'dispatch-1',
  jobId: 'job-1',
  itemId: 'item-1',
  recipeId: 'portrait',
  providerProfileId: STUDIO_PROFILE_ID,
  effectiveSpecHash: 'a'.repeat(64),
  attempt: 1,
  seed: 1,
  preparedHash: 'b'.repeat(64),
  status: 'pending',
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
});

const artifact = (overrides: Partial<GenerationArtifact> = {}): GenerationArtifact => ({
  schemaVersion: 1,
  ticketId: 'ticket-1',
  dispatchId: 'dispatch-1',
  candidateId: 'candidate-1',
  kind: 'image',
  mimeType: 'image/png',
  bytes: 1024,
  sha256: 'c'.repeat(64),
  uploadedAt: '2026-09-14T00:00:00.000Z',
  expiresAt: '2026-09-14T01:00:00.000Z',
  retrievalPath: '/api/generation/runner-artifacts/ticket-1/raw',
  uploaded: true,
  expired: false,
  ...overrides,
});

const createClient = (
  overrides: Partial<GenerationRunnerClientInterface> = {},
): GenerationRunnerClientInterface => ({
  listRunners: async () => [device()],
  availability: async () => ({
    schemaVersion: 1,
    available: true,
    mode: 'paired_outbound',
    deviceId: 'dev_1',
  }),
  createPairingCode: async (): Promise<RunnerPairingCode> => ({
    code: 'ABCD-2345-6789',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    command:
      'bun run --cwd apps/backend/local-stack runner:pair --hub <HUB_ORIGIN> --code ABCD-2345-6789',
  }),
  revokeRunner: async (deviceId) => device({ deviceId, revoked: true, online: false }),
  setArtifactUpload: async (deviceId, enabled) =>
    device({ deviceId, artifactUploadEnabled: enabled }),
  listDispatches: async () => [dispatch()],
  listCandidates: async () => [candidate()],
  listArtifacts: async () => [artifact()],
  reviewCandidate: async () => undefined,
  requestCancel: async () => ({ requested: true, confirmed: false }),
  ...overrides,
});

const createViewModel = (
  options: {
    client?: Partial<GenerationRunnerClientInterface>;
    signedIn?: boolean;
    configured?: boolean;
  } = {},
) =>
  createHubStudioAssetsViewModel({
    className: 'HubStudioAssetsViewModel',
    signedIn: options.signedIn ?? true,
    configured: options.configured ?? true,
    devices: [device()],
    client: createClient(options.client),
  });

describe('AC-6: every action announces its outcome in the live region', () => {
  test('refresh loads devices, dispatches, candidates and artifacts', async () => {
    const viewModel = createViewModel();
    await viewModel.refresh();
    expect(viewModel.devices).toHaveLength(1);
    expect(viewModel.dispatches).toHaveLength(1);
    expect(viewModel.dispatches[0]?.artifacts).toHaveLength(1);
    expect(viewModel.candidates).toHaveLength(1);
    expect(viewModel.availability?.available).toBe(true);
    expect(viewModel.failureMessage).toBeUndefined();
  });

  test('a failed artifact list is an error, not a local-only result', async () => {
    const viewModel = createViewModel({
      client: {
        listArtifacts: async () => {
          throw new Error('network down');
        },
      },
    });
    await viewModel.refresh();
    expect(viewModel.dispatches[0]?.artifactsUnavailable).toBe(true);
    // The confirmed-empty statement must not be shown for a failed load.
    expect(viewModel.localOnlyStatement('dispatch-1')).toBeUndefined();
    expect(viewModel.artifactsErrorFor('dispatch-1')).toContain('Could not load');
  });

  test('a refresh in flight blocks a concurrent mutation', async () => {
    let release: (() => void) | undefined;
    const revokeRunner = mock(async (deviceId: string) => device({ deviceId, revoked: true }));
    const viewModel = createViewModel({
      client: {
        listRunners: () =>
          new Promise((resolve) => {
            release = () => resolve([]);
          }),
        revokeRunner,
      },
    });
    const refreshing = viewModel.refresh();
    await viewModel.revokeRunner('dev_1');
    expect(revokeRunner).not.toHaveBeenCalled();
    release?.();
    await refreshing;
  });

  test('a refresh with no session never calls the API', async () => {
    const listRunners = mock(async () => []);
    const viewModel = createViewModel({ signedIn: false, client: { listRunners } });
    await viewModel.refresh();
    expect(listRunners).not.toHaveBeenCalled();
    expect(viewModel.devices).toHaveLength(1);
  });

  test('creating a pairing code announces the code and its expiry', async () => {
    const viewModel = createViewModel();
    await viewModel.createPairingCode();
    expect(viewModel.statusMessage).toContain('ABCD-2345-6789');
    expect(viewModel.statusMessage).toContain('valid for');
    expect(viewModel.pairingCode?.command).toContain('runner:pair');
  });

  test('revocation says it does not delete local work', async () => {
    const viewModel = createViewModel();
    await viewModel.revokeRunner('dev_1');
    expect(viewModel.devices[0]?.revoked).toBe(true);
    expect(viewModel.statusMessage).toContain('untouched');
  });

  test('a cancel is announced as a request, not a confirmation', async () => {
    const viewModel = createViewModel();
    await viewModel.cancelDispatch('dispatch-1');
    expect(viewModel.statusMessage).toContain('requested');
    expect(viewModel.statusMessage).not.toContain('confirmed');
  });

  test('a confirmed cancel says so', async () => {
    const viewModel = createViewModel({
      client: { requestCancel: async () => ({ requested: true, confirmed: true }) },
    });
    await viewModel.cancelDispatch('dispatch-1');
    expect(viewModel.statusMessage).toContain('confirmed');
  });

  test('accepting a candidate announces that it is not published', async () => {
    const viewModel = createViewModel();
    await viewModel.refresh();
    await viewModel.reviewCandidate('candidate-1', 'accept');
    expect(viewModel.candidates[0]?.status).toBe('accepted');
    expect(viewModel.statusMessage).toContain('not published');
  });

  test('rejecting says nothing was deleted', async () => {
    const viewModel = createViewModel();
    await viewModel.refresh();
    await viewModel.reviewCandidate('candidate-1', 'reject');
    expect(viewModel.statusMessage).toContain('Nothing was deleted');
  });

  test('a failing call reports the message and never throws at the View', async () => {
    const viewModel = createViewModel({
      client: {
        createPairingCode: async () => {
          throw new Error('this hub deployment has no generation store configured');
        },
      },
    });
    await viewModel.createPairingCode();
    expect(viewModel.failureMessage).toContain('no generation store');
    expect(viewModel.statusMessage).toContain('Could not create');
    expect(viewModel.busy).toBe(false);
  });
});

describe('AC-2/AC-3: only an uploaded, unexpired image has a preview source', () => {
  test('a local-only artifact has no source and reads as a stated outcome', () => {
    const viewModel = createViewModel();
    expect(viewModel.imageSourceFor(artifact())).toBe(
      '/api/generation/runner-artifacts/ticket-1/raw',
    );
    for (const blocked of [
      artifact({ uploaded: false }),
      artifact({ expired: true }),
      artifact({ kind: 'audio' }),
    ]) {
      expect(viewModel.imageSourceFor(blocked)).toBeUndefined();
    }
  });

  test('cancellable only while the job is still running', () => {
    const viewModel = createViewModel();
    expect(viewModel.isCancellable(dispatch({ status: 'running' }))).toBe(true);
    expect(viewModel.isCancellable(dispatch({ status: 'queued' }))).toBe(true);
    for (const status of ['succeeded', 'failed', 'cancelled', 'awaiting_review'] as const) {
      expect(viewModel.isCancellable(dispatch({ status }))).toBe(false);
    }
  });

  test('status labels are readable prose, not raw enum values', () => {
    const viewModel = createViewModel();
    expect(viewModel.statusLabel(dispatch({ status: 'awaiting_review' }))).toBe('awaiting review');
    expect(viewModel.statusLabel(dispatch({ status: 'reconciliation_required' }))).toBe(
      'reconciliation required',
    );
  });
});

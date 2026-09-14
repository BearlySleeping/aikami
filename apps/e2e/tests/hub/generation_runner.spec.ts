// apps/e2e/tests/hub/generation_runner.spec.ts
//
// C-522 — the Hub ↔ creator-GPU runner, against the real hub.
//
// 🔴 This spec drives the *production seam over HTTP*: real Better Auth session,
// real D1 schema, real handler composition. That matters here specifically,
// because the previous round shipped two defects that no unit test with a fake
// client could see:
//
//   * the runner reported the TERMINAL status (`awaiting_review`) before the
//     candidate. `awaiting_review` releases the dispatch's lease, so the
//     candidate report was refused `stale_attempt` and every real job lost its
//     candidate row while the dispatch still looked healthy;
//   * the Hub filtered the caller's own dispatch out of
//     `pendingCancellationDispatchIds`, so the only dispatch a runner ever asks
//     about could never carry its own cancel answer — cancellation was
//     undeliverable and a cancelled job ran to completion.
//
// Both are exercised below in the order the shipped runner actually makes the
// calls, so a regression fails here rather than in the field.
//
// Skipped when the hub instance has no D1/R2 bindings (local `vite dev` without
// the platform proxy) — the same guard the map-studio API spec uses.

import { localProviderProfileForEngine } from '@aikami/constants';
import { type APIRequestContext, expect, test } from '@playwright/test';

/**
 * The provider profile the client studio's portrait recipe resolves to.
 *
 * 🔴 Resolved from the registry, never written down. These fixtures used to copy
 * the studio's `local-sdcpp` / `image-default` literals — ids in no registry —
 * so they passed while the real runner refused every dispatch: the Hub never
 * validates a profile id, which is exactly why the defect reached production.
 * Sharing the resolver is what makes a fixture able to catch it.
 */
const STUDIO_PROFILE_ID =
  localProviderProfileForEngine({ engineId: 'sdcpp', modality: 'image' })?.id ?? '';
if (STUDIO_PROFILE_ID === '') {
  throw new Error('no local provider profile serves the studio portrait recipe');
}

/** The brief-namespace preparation key the studio and the shipped brief write. */
const STUDIO_PREPARATION_PROFILE = 'portrait';

/** A full, schema-valid budget (the dispatch spec carries the shared shape). */
const FULL_BUDGET = {
  gpuConcurrency: 1,
  candidateLimitPerItem: 1,
  maxCandidatesPerRun: 1,
  hostedBudgetUsd: 0,
  maxDurationSeconds: 0,
  maxPixels: 4_194_304,
  maxRetainedBytes: 33_554_432,
  maxRequestedAudioSecondsPerCandidatePass: 0,
};

/** A unique id per run, so repeated runs never collide on a primary key. */
const unique = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

type HubSession = { headers: { cookie: string }; email: string };

/**
 * Creates and signs in a fresh account through the real Better Auth endpoints.
 *
 * 🔴 The `origin` header is mandatory: Better Auth's CSRF guard answers
 * `403 MISSING_OR_NULL_ORIGIN` for a state-changing request without one, and
 * Playwright's `APIRequestContext` sends no `Origin` by default (a browser
 * would). Omitting it fails every test in this file at the first sign-in with a
 * misleading "response not ok".
 */
const signIn = async (
  request: APIRequestContext,
  baseURL: string | undefined,
): Promise<HubSession> => {
  const email = `${unique('c522')}@example.com`;
  const password = 'password123';
  const origin = baseURL ?? 'http://localhost';
  await request.post('/api/auth/sign-up/email', {
    headers: { origin },
    data: { name: 'C-522 E2E', email, password },
  });
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { origin },
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const cookie = response.headers()['set-cookie']?.split(';')[0] ?? '';
  expect(cookie).toContain('=');
  return { headers: { cookie }, email };
};

/** Mint a pairing code for a session and consume it as a new device. */
const pairDevice = async (options: {
  request: APIRequestContext;
  session: HubSession;
  deviceId: string;
  modalities?: readonly string[];
}): Promise<{ deviceId: string; token: string }> => {
  const codeResponse = await options.request.post('/api/generation/runners/pairing-code', {
    headers: options.session.headers,
  });
  expect(codeResponse.status()).toBe(201);
  const { code } = (await codeResponse.json()) as { code: string };
  const pairResponse = await options.request.post('/api/generation/runners/pair', {
    data: {
      schemaVersion: 1,
      code,
      deviceId: options.deviceId,
      label: 'E2E runner',
      platform: 'linux',
      modalities: options.modalities ?? ['image'],
      resourceGroups: ['gpu:0'],
    },
  });
  expect(pairResponse.status()).toBe(201);
  return {
    deviceId: options.deviceId,
    token: ((await pairResponse.json()) as { token: string }).token,
  };
};

/** Enqueue a dispatch owned by the session, routed to one paired device. */
const createDispatch = async (options: {
  request: APIRequestContext;
  session: HubSession;
  deviceId: string;
  jobId: string;
  effectiveSpecHash: string;
}): Promise<string> => {
  const response = await options.request.post('/api/generation/dispatches', {
    headers: options.session.headers,
    data: {
      deviceId: options.deviceId,
      jobId: options.jobId,
      requestKey: `${options.jobId}:k`,
      effectiveSpecHash: options.effectiveSpecHash,
      spec: {
        itemId: 'e2e-item',
        recipeId: 'portrait',
        modality: 'image',
        providerProfileId: STUDIO_PROFILE_ID,
        preparationProfile: STUDIO_PREPARATION_PROFILE,
        referenceIds: [],
        seed: 1,
        candidateLimit: 1,
        budget: FULL_BUDGET,
        prompt: 'an e2e hero portrait',
      },
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { dispatchId: string }).dispatchId;
};

/** Claim the queued dispatch, returning the fence the runner would hold. */
const claim = async (options: {
  request: APIRequestContext;
  deviceId: string;
  token: string;
}): Promise<{ attempt: number; leaseId: string }> => {
  const response = await options.request.post('/api/generation/runners/claim', {
    headers: { authorization: `Bearer ${options.token}` },
    data: {
      schemaVersion: 1,
      deviceId: options.deviceId,
      resourceGroup: 'gpu:0',
      runnerNow: new Date().toISOString(),
      leaseTtlMs: 300_000,
      modalities: ['image'],
    },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    claimed: boolean;
    fence: { attempt: number; lease: { leaseId: string } };
  };
  expect(body.claimed).toBe(true);
  return { attempt: body.fence.attempt, leaseId: body.fence.lease.leaseId };
};

/** A status heartbeat, in the shape the runner sends it. */
const heartbeat = (options: {
  request: APIRequestContext;
  deviceId: string;
  token: string;
  dispatchId: string;
  attempt: number;
  leaseId: string;
  status: string;
}) =>
  options.request.post('/api/generation/runners/status', {
    headers: { authorization: `Bearer ${options.token}` },
    data: {
      schemaVersion: 1,
      deviceId: options.deviceId,
      dispatchId: options.dispatchId,
      attempt: options.attempt,
      leaseId: options.leaseId,
      status: options.status,
      candidateCount: 0,
      runnerNow: new Date().toISOString(),
    },
  });

/** True when this hub instance has no generation store. */
const hubUnconfigured = async (request: APIRequestContext): Promise<boolean> =>
  (await request.get('/api/generation/runners')).status() === 503;

test.describe('Generation runner API — C-522 (requires D1)', () => {
  test.beforeEach(async ({ request }) => {
    test.skip(await hubUnconfigured(request), 'hub has no D1 bindings in this instance');
  });

  test('AC-1: the shipped completion order persists the candidate and releases the lease', async ({
    request,
    baseURL,
  }) => {
    // 🔴 The shipped order: candidate FIRST, then the terminal status.
    // Reversing these two is what silently lost every candidate in production,
    // so this test is the regression guard for it.
    const session = await signIn(request, baseURL);
    const device = await pairDevice({ request, session, deviceId: unique('dev_done') });
    const dispatchId = await createDispatch({
      request,
      session,
      deviceId: device.deviceId,
      jobId: unique('job-done'),
      effectiveSpecHash: 'a'.repeat(64),
    });
    const { attempt, leaseId } = await claim({
      request,
      deviceId: device.deviceId,
      token: device.token,
    });
    const candidateId = unique('candidate');

    const candidateResponse = await request.post('/api/generation/runners/candidates', {
      headers: { authorization: `Bearer ${device.token}` },
      data: {
        schemaVersion: 1,
        deviceId: device.deviceId,
        dispatchId,
        attempt,
        leaseId,
        candidateId,
        preparedHash: 'b'.repeat(64),
        seed: 1,
        provenanceState: 'partial',
        runnerNow: new Date().toISOString(),
      },
    });
    expect(candidateResponse.status()).toBe(201);
    expect(((await candidateResponse.json()) as { published: number }).published).toBe(0);

    const terminal = await request.post('/api/generation/runners/status', {
      headers: { authorization: `Bearer ${device.token}` },
      data: {
        schemaVersion: 1,
        deviceId: device.deviceId,
        dispatchId,
        attempt,
        leaseId,
        status: 'awaiting_review',
        candidateCount: 1,
        candidateId,
        preparedHash: 'b'.repeat(64),
        runnerNow: new Date().toISOString(),
      },
    });
    expect(terminal.status()).toBe(200);

    // The candidate is reviewable through the owner-facing API.
    const candidates = await request.get('/api/generation/candidates', {
      headers: session.headers,
    });
    const rows = (await candidates.json()) as Array<{ candidateId: string; status: string }>;
    expect(rows.map((row) => row.candidateId)).toContain(candidateId);
    expect(rows.find((row) => row.candidateId === candidateId)?.status).toBe('pending');

    // …and the dispatch finished with its lease released.
    const dispatch = await request.get(`/api/generation/dispatches/${dispatchId}`, {
      headers: session.headers,
    });
    const body = (await dispatch.json()) as { status: string; fence?: unknown };
    expect(body.status).toBe('awaiting_review');
    expect(body.fence).toBeUndefined();
  });

  test('AC-1: a candidate arriving after the terminal release is still recorded', async ({
    request,
    baseURL,
  }) => {
    // Defence in depth for a reconnecting or older runner: the attempt is the
    // fence, and a legitimately released lease is not a stale result.
    const session = await signIn(request, baseURL);
    const device = await pairDevice({ request, session, deviceId: unique('dev_late') });
    const dispatchId = await createDispatch({
      request,
      session,
      deviceId: device.deviceId,
      jobId: unique('job-late'),
      effectiveSpecHash: 'c'.repeat(64),
    });
    const { attempt, leaseId } = await claim({
      request,
      deviceId: device.deviceId,
      token: device.token,
    });

    const terminal = await heartbeat({
      request,
      deviceId: device.deviceId,
      token: device.token,
      dispatchId,
      attempt,
      leaseId,
      status: 'awaiting_review',
    });
    expect(terminal.status()).toBe(200);

    const candidateId = unique('candidate-late');
    const late = await request.post('/api/generation/runners/candidates', {
      headers: { authorization: `Bearer ${device.token}` },
      data: {
        schemaVersion: 1,
        deviceId: device.deviceId,
        dispatchId,
        attempt,
        leaseId,
        candidateId,
        preparedHash: 'd'.repeat(64),
        seed: 1,
        provenanceState: 'partial',
        runnerNow: new Date().toISOString(),
      },
    });
    expect(late.status()).toBe(201);
    const listed = await request.get('/api/generation/candidates', { headers: session.headers });
    expect(
      ((await listed.json()) as Array<{ candidateId: string }>).map((row) => row.candidateId),
    ).toContain(candidateId);
  });

  test('AC-6: a status heartbeat is answered about its own dispatch’s cancel ask', async ({
    request,
    baseURL,
  }) => {
    // 🔴 The Hub used to filter the caller's own id out of the answer, which
    // made a cancel undeliverable for exactly the dispatch that needed it.
    const session = await signIn(request, baseURL);
    const device = await pairDevice({ request, session, deviceId: unique('dev_cancel') });
    const dispatchId = await createDispatch({
      request,
      session,
      deviceId: device.deviceId,
      jobId: unique('job-cancel'),
      effectiveSpecHash: 'e'.repeat(64),
    });
    const { attempt, leaseId } = await claim({
      request,
      deviceId: device.deviceId,
      token: device.token,
    });

    const cancel = await request.post(`/api/generation/dispatches/${dispatchId}/cancel`, {
      headers: session.headers,
    });
    expect(cancel.status()).toBe(202);
    const cancelBody = (await cancel.json()) as {
      cancellation: { requested: boolean; confirmed: boolean };
    };
    expect(cancelBody.cancellation.requested).toBe(true);
    // A request is never reported as a provider-side confirmation.
    expect(cancelBody.cancellation.confirmed).toBe(false);

    const answer = await heartbeat({
      request,
      deviceId: device.deviceId,
      token: device.token,
      dispatchId,
      attempt,
      leaseId,
      status: 'running',
    });
    expect(answer.status()).toBe(200);
    const body = (await answer.json()) as { pendingCancellationDispatchIds: string[] };
    expect(body.pendingCancellationDispatchIds).toContain(dispatchId);

    // Reporting the confirmed stop retires the ask rather than re-offering it.
    const confirmed = await request.post('/api/generation/runners/status', {
      headers: { authorization: `Bearer ${device.token}` },
      data: {
        schemaVersion: 1,
        deviceId: device.deviceId,
        dispatchId,
        attempt,
        leaseId,
        status: 'cancelled',
        candidateCount: 0,
        cancellation: {
          requested: true,
          requestedAt: new Date().toISOString(),
          confirmed: true,
          confirmedAt: new Date().toISOString(),
        },
        runnerNow: new Date().toISOString(),
      },
    });
    expect(confirmed.status()).toBe(200);
    expect(
      ((await confirmed.json()) as { pendingCancellationDispatchIds: string[] })
        .pendingCancellationDispatchIds,
    ).not.toContain(dispatchId);
  });

  test('AC-4: the fence rejects a stale attempt and a foreign lease by name', async ({
    request,
    baseURL,
  }) => {
    const session = await signIn(request, baseURL);
    const device = await pairDevice({ request, session, deviceId: unique('dev_fence') });
    const dispatchId = await createDispatch({
      request,
      session,
      deviceId: device.deviceId,
      jobId: unique('job-fence'),
      effectiveSpecHash: 'f'.repeat(64),
    });
    const { attempt, leaseId } = await claim({
      request,
      deviceId: device.deviceId,
      token: device.token,
    });

    const stale = await request.post('/api/generation/runners/status', {
      headers: { authorization: `Bearer ${device.token}` },
      data: {
        schemaVersion: 1,
        deviceId: device.deviceId,
        dispatchId,
        attempt: attempt + 1,
        leaseId,
        status: 'succeeded',
        candidateCount: 1,
        runnerNow: new Date().toISOString(),
      },
    });
    expect(stale.status()).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('stale_attempt');

    const foreignLease = await heartbeat({
      request,
      deviceId: device.deviceId,
      token: device.token,
      dispatchId,
      attempt,
      leaseId: 'not-the-lease',
      status: 'succeeded',
    });
    expect(foreignLease.status()).toBe(409);
    expect(((await foreignLease.json()) as { code: string }).code).toBe('lease_not_held');

    // A malformed body is a schema error, not a device error.
    const malformed = await request.post('/api/generation/runners/status', {
      headers: { authorization: `Bearer ${device.token}` },
      data: { nonsense: true },
    });
    expect(malformed.status()).toBe(400);
    expect(((await malformed.json()) as { code: string }).code).toBe('invalid_request');

    // The refused updates changed nothing.
    const unchanged = await request.get(`/api/generation/dispatches/${dispatchId}`, {
      headers: session.headers,
    });
    expect(((await unchanged.json()) as { status: string }).status).toBe('running');
  });

  test('AC-2: a second device of the same owner cannot report on the first device’s job', async ({
    request,
    baseURL,
  }) => {
    // Ownership alone is not the routing rule: a dispatch goes to exactly one
    // paired device, and only that device may speak for it.
    const session = await signIn(request, baseURL);
    const first = await pairDevice({ request, session, deviceId: unique('dev_first') });
    const second = await pairDevice({ request, session, deviceId: unique('dev_second') });
    const dispatchId = await createDispatch({
      request,
      session,
      deviceId: first.deviceId,
      jobId: unique('job_route'),
      effectiveSpecHash: '1'.repeat(64),
    });
    const { attempt, leaseId } = await claim({
      request,
      deviceId: first.deviceId,
      token: first.token,
    });

    const crossed = await heartbeat({
      request,
      deviceId: second.deviceId,
      token: second.token,
      dispatchId,
      attempt,
      leaseId,
      status: 'succeeded',
    });
    expect(crossed.status()).toBe(403);
    expect(((await crossed.json()) as { code: string }).code).toBe('device_mismatch');
  });

  test('AC-2: pairing, ownership and revocation hold on the real routes', async ({
    request,
    baseURL,
  }) => {
    const alice = await signIn(request, baseURL);
    const bob = await signIn(request, baseURL);
    const aliceDevice = await pairDevice({
      request,
      session: alice,
      deviceId: unique('dev_alice'),
    });
    const bobDevice = await pairDevice({ request, session: bob, deviceId: unique('dev_bob') });
    const dispatchId = await createDispatch({
      request,
      session: alice,
      deviceId: aliceDevice.deviceId,
      jobId: unique('job_owner'),
      effectiveSpecHash: '2'.repeat(64),
    });

    // The device list never carries a credential.
    const listed = await request.get('/api/generation/runners', { headers: alice.headers });
    const devices = (await listed.json()) as Array<Record<string, unknown>>;
    expect(devices).toHaveLength(1);
    expect(devices[0]?.tokenHash).toBeUndefined();
    expect(JSON.stringify(devices)).not.toContain('rt_');

    // A crossed account cannot read, cancel or claim.
    const crossedRead = await request.get(`/api/generation/dispatches/${dispatchId}`, {
      headers: bob.headers,
    });
    expect(crossedRead.status()).toBe(404);
    const crossedCancel = await request.post(`/api/generation/dispatches/${dispatchId}/cancel`, {
      headers: bob.headers,
    });
    expect(crossedCancel.status()).toBe(404);
    const bobClaim = await request.post('/api/generation/runners/claim', {
      headers: { authorization: `Bearer ${bobDevice.token}` },
      data: {
        schemaVersion: 1,
        deviceId: bobDevice.deviceId,
        resourceGroup: 'gpu:0',
        runnerNow: new Date().toISOString(),
        leaseTtlMs: 300_000,
        modalities: ['image'],
      },
    });
    expect(((await bobClaim.json()) as { claimed: boolean }).claimed).toBe(false);

    // Revocation blocks new claims and leaves the queued dispatch intact.
    const revoke = await request.delete(`/api/generation/runners/${aliceDevice.deviceId}`, {
      headers: alice.headers,
    });
    expect(revoke.status()).toBe(200);
    const revokedClaim = await request.post('/api/generation/runners/claim', {
      headers: { authorization: `Bearer ${aliceDevice.token}` },
      data: {
        schemaVersion: 1,
        deviceId: aliceDevice.deviceId,
        resourceGroup: 'gpu:0',
        runnerNow: new Date().toISOString(),
        leaseTtlMs: 300_000,
        modalities: ['image'],
      },
    });
    expect(revokedClaim.status()).toBe(403);
    expect(((await revokedClaim.json()) as { code: string }).code).toBe('device_revoked');
    const stillQueued = await request.get(`/api/generation/dispatches/${dispatchId}`, {
      headers: alice.headers,
    });
    expect(((await stillQueued.json()) as { status: string }).status).toBe('queued');

    // A format-valid but unknown credential is unauthorized, not a 500.
    const unknown = await request.post('/api/generation/runners/claim', {
      headers: { authorization: `Bearer rt_dev_unknown_1.${'0'.repeat(48)}` },
      data: {
        schemaVersion: 1,
        deviceId: 'dev_unknown_1',
        resourceGroup: 'gpu:0',
        runnerNow: new Date().toISOString(),
        leaseTtlMs: 300_000,
        modalities: ['image'],
      },
    });
    expect(unknown.status()).toBe(401);
  });

  test('AC-3: availability resolves to a paired device, then names why it cannot', async ({
    request,
    baseURL,
  }) => {
    const session = await signIn(request, baseURL);

    const none = await request.get('/api/generation/runners/availability', {
      headers: session.headers,
    });
    const noneBody = (await none.json()) as { available: boolean; code: string; remedy: string };
    expect(noneBody.available).toBe(false);
    expect(noneBody.code).toBe('no_runner_paired');
    expect(noneBody.remedy).toContain('runner:pair');

    const device = await pairDevice({ request, session, deviceId: unique('dev_avail') });
    const online = await request.get('/api/generation/runners/availability', {
      headers: session.headers,
    });
    const onlineBody = (await online.json()) as { available: boolean; mode: string };
    expect(onlineBody.available).toBe(true);
    expect(onlineBody.mode).toBe('paired_outbound');

    await request.delete(`/api/generation/runners/${device.deviceId}`, {
      headers: session.headers,
    });
    const revoked = await request.get('/api/generation/runners/availability', {
      headers: session.headers,
    });
    expect(((await revoked.json()) as { code: string }).code).toBe('runner_revoked');
  });

  test('AC-1: re-submitting the same locked request resolves to one dispatch', async ({
    request,
    baseURL,
  }) => {
    const session = await signIn(request, baseURL);
    const device = await pairDevice({ request, session, deviceId: unique('dev_idem') });
    const jobId = unique('job-idem');
    const body = {
      deviceId: device.deviceId,
      jobId,
      requestKey: `${jobId}:k`,
      effectiveSpecHash: '3'.repeat(64),
      spec: {
        itemId: 'e2e-item',
        recipeId: 'portrait',
        modality: 'image',
        providerProfileId: STUDIO_PROFILE_ID,
        preparationProfile: STUDIO_PREPARATION_PROFILE,
        referenceIds: [],
        seed: 1,
        candidateLimit: 1,
        budget: FULL_BUDGET,
        prompt: 'an e2e hero portrait',
      },
    };
    const first = await request.post('/api/generation/dispatches', {
      headers: session.headers,
      data: body,
    });
    expect(first.status()).toBe(201);
    const firstId = ((await first.json()) as { dispatchId: string }).dispatchId;
    const second = await request.post('/api/generation/dispatches', {
      headers: session.headers,
      data: body,
    });
    expect(second.status()).toBe(200);
    expect(((await second.json()) as { dispatchId: string }).dispatchId).toBe(firstId);
  });

  test('AC-1: a dispatch spec with an unknown field is refused outright', async ({
    request,
    baseURL,
  }) => {
    const session = await signIn(request, baseURL);
    const device = await pairDevice({ request, session, deviceId: unique('dev_allow') });
    for (const smuggled of [
      { command: 'rm -rf /' },
      { engineUrl: 'http://127.0.0.1:8188/' },
      { callbackUrl: 'https://example.invalid/hook' },
    ]) {
      const response = await request.post('/api/generation/dispatches', {
        headers: session.headers,
        data: {
          deviceId: device.deviceId,
          jobId: unique('job-smuggle'),
          requestKey: 'k',
          effectiveSpecHash: '4'.repeat(64),
          spec: {
            itemId: 'e2e-item',
            recipeId: 'portrait',
            modality: 'image',
            providerProfileId: STUDIO_PROFILE_ID,
            preparationProfile: STUDIO_PREPARATION_PROFILE,
            referenceIds: [],
            seed: 1,
            candidateLimit: 1,
            budget: FULL_BUDGET,
            prompt: 'x',
            ...smuggled,
          },
        },
      });
      expect(response.status()).toBe(422);
    }
  });
});

test.describe('Hub Studio → Generation review surface — C-522 AC-6', () => {
  test('a keyboard-only journey reviews a private result and announces it is not published', async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(await hubUnconfigured(request), 'hub has no D1 bindings in this instance');

    const session = await signIn(request, baseURL);
    const device = await pairDevice({ request, session, deviceId: unique('dev_ui') });
    const dispatchId = await createDispatch({
      request,
      session,
      deviceId: device.deviceId,
      jobId: unique('job_ui'),
      effectiveSpecHash: '5'.repeat(64),
    });
    const { attempt, leaseId } = await claim({
      request,
      deviceId: device.deviceId,
      token: device.token,
    });
    const candidateId = unique('candidate_ui');
    await request.post('/api/generation/runners/candidates', {
      headers: { authorization: `Bearer ${device.token}` },
      data: {
        schemaVersion: 1,
        deviceId: device.deviceId,
        dispatchId,
        attempt,
        leaseId,
        candidateId,
        preparedHash: '6'.repeat(64),
        seed: 1,
        provenanceState: 'partial',
        runnerNow: new Date().toISOString(),
      },
    });
    await heartbeat({
      request,
      deviceId: device.deviceId,
      token: device.token,
      dispatchId,
      attempt,
      leaseId,
      status: 'awaiting_review',
    });

    // Reuse the API session for the browser.
    const [cookieName, ...cookieRest] = session.headers.cookie.split('=');
    await page
      .context()
      .addCookies([
        { name: cookieName, value: cookieRest.join('='), url: baseURL ?? 'http://localhost' },
      ]);
    await page.goto('/studio/assets');

    await expect(page.getByRole('heading', { name: 'Generation studio' })).toBeVisible();
    // One polite live region for the whole surface.
    const live = page.getByTestId('status-message');
    await expect(live).toHaveAttribute('role', 'status');

    // Keyboard-only: focus Accept with Tab and activate it with Enter.
    const accept = page.getByRole('button', { name: /Accept candidate/i }).first();
    await expect(accept).toBeVisible();
    await accept.focus();
    await expect(accept).toBeFocused();
    await page.keyboard.press('Enter');

    // The announcement states the private half out loud.
    await expect(live).toContainText('not published', { timeout: 15_000 });
    await expect(page.locator('.candidate').first()).toContainText('accepted');
  });

  test('a finished local-only job states where its bytes are', async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(await hubUnconfigured(request), 'hub has no D1 bindings in this instance');

    const session = await signIn(request, baseURL);
    // Preview upload left off — the default — so no artifact ticket exists.
    const device = await pairDevice({ request, session, deviceId: unique('dev_local') });
    const dispatchId = await createDispatch({
      request,
      session,
      deviceId: device.deviceId,
      jobId: unique('job_local'),
      effectiveSpecHash: '7'.repeat(64),
    });
    const { attempt, leaseId } = await claim({
      request,
      deviceId: device.deviceId,
      token: device.token,
    });
    await request.post('/api/generation/runners/candidates', {
      headers: { authorization: `Bearer ${device.token}` },
      data: {
        schemaVersion: 1,
        deviceId: device.deviceId,
        dispatchId,
        attempt,
        leaseId,
        candidateId: unique('candidate_local'),
        preparedHash: '8'.repeat(64),
        seed: 1,
        provenanceState: 'partial',
        runnerNow: new Date().toISOString(),
      },
    });
    await heartbeat({
      request,
      deviceId: device.deviceId,
      token: device.token,
      dispatchId,
      attempt,
      leaseId,
      status: 'awaiting_review',
    });

    const [cookieName, ...cookieRest] = session.headers.cookie.split('=');
    await page
      .context()
      .addCookies([
        { name: cookieName, value: cookieRest.join('='), url: baseURL ?? 'http://localhost' },
      ]);
    await page.goto('/studio/assets');

    // The creator is told the result is on the runner — not left with a bare
    // status line and no artifact.
    await expect(page.getByTestId('local-only-result')).toContainText(
      'only on the paired machine',
      {
        timeout: 15_000,
      },
    );
  });
});

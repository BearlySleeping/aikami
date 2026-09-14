// apps/backend/local-stack/stack/generation/hub_runner_client.ts
//
// C-522 — the runner side of the Hub dispatch protocol.
//
// Every call here is *outbound*. The Hub cannot dial this machine (a Worker
// `fetch` to `127.0.0.1` targets the Worker's own isolate, and a runner behind
// NAT/CGNAT has no inbound path), so pairing, claim, status and artifact
// transfer are all requests this process makes and the Hub answers.
//
// Refusals are *values*, not exceptions: the Hub answers with a named code
// (`stale_attempt`, `lease_not_held`, `device_revoked`, …) and every caller
// here has to decide what to do about it. Throwing would collapse "my
// credential died" and "someone else won the race" into one unactionable
// failure and invite a retry loop.
//
// Contract: C-522 Hub and client access to the generation runner

import type {
  GenerationDispatch,
  GenerationDispatchFence,
  GenerationDispatchRejectionCode,
  GenerationJobCancellation,
  GenerationJobStatus,
  RunnerClaimResponse,
  RunnerPairResponse,
  RunnerStatusUpdateResponse,
} from '@aikami/types';

/** One refusal, with the Hub's own machine-readable code. */
export type HubRunnerRefusal = {
  ok: false;
  status: number;
  code: GenerationDispatchRejectionCode | 'transport_failed';
  message: string;
};

/**
 * Exhaustive result of one Hub call.
 *
 * `unconfigured` is deliberately absent: the runner always has a Hub origin, so
 * "no Hub" is a `transport_failed` refusal like any other.
 */
export type HubRunnerResult<T> = { ok: true; value: T } | HubRunnerRefusal;

/** Injection seams so every call is testable without a network. */
export type HubRunnerClientOptions = {
  /** Hub origin, e.g. `https://hub.bearlysleeping.com`. */
  hubOrigin: string;
  /** The runner's bearer credential, or undefined before pairing. */
  token?: string;
  /** Test seam — defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Parse a refusal body, tolerating anything the Hub (or a proxy) answers. */
const refusalFrom = async (response: Response): Promise<HubRunnerRefusal> => {
  let code: HubRunnerRefusal['code'] = 'transport_failed';
  let message = `hub answered ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      if (typeof body.code === 'string') {
        code = body.code as GenerationDispatchRejectionCode;
      }
      if (typeof body.message === 'string') {
        message = body.message;
      } else if (typeof body.error === 'string') {
        message = body.error;
      }
    }
  } catch {
    // A non-JSON body (a proxy error page) is still a refusal — just an
    // unnamed one. Never surface the raw body: it may carry credential echoes.
  }
  return { ok: false, status: response.status, code, message };
};

/**
 * The transport. One instance per runner process; `token` is held in memory
 * only — the caller decides where (if anywhere) to persist it.
 */
export const createHubRunnerClient = (options: HubRunnerClientOptions) => {
  const doFetch = options.fetchImpl ?? fetch;
  let token = options.token;

  const post = async <T>(params: {
    path: string;
    body?: unknown;
    /** Authenticate as the paired device rather than as a browser session. */
    authenticated?: boolean;
  }): Promise<HubRunnerResult<T>> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (params.authenticated) {
      if (!token) {
        return {
          ok: false,
          status: 401,
          code: 'unauthorized',
          message: 'this runner has no credential — pair it first',
        };
      }
      headers.authorization = `Bearer ${token}`;
    }
    let response: Response;
    try {
      response = await doFetch(`${options.hubOrigin}${params.path}`, {
        method: 'POST',
        headers,
        ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
      });
    } catch (error) {
      // A dropped connection is retryable and must never look like a fence
      // failure — the caller retries the *same* request, it does not reconcile.
      return {
        ok: false,
        status: 0,
        code: 'transport_failed',
        message: error instanceof Error ? error.message : 'hub unreachable',
      };
    }
    if (!response.ok) {
      return refusalFrom(response);
    }
    return { ok: true, value: (await response.json()) as T };
  };

  return {
    /** The credential this client will present (undefined before pairing). */
    token: (): string | undefined => token,

    /** `POST /api/generation/runners/pair` — consume a pairing code. */
    pair: (params: {
      code: string;
      deviceId: string;
      label: string;
      platform: string;
      modalities: readonly string[];
      resourceGroups: readonly string[];
      artifactUploadEnabled?: boolean;
    }): Promise<HubRunnerResult<RunnerPairResponse>> =>
      post<RunnerPairResponse>({
        path: '/api/generation/runners/pair',
        body: {
          schemaVersion: 1,
          code: params.code,
          deviceId: params.deviceId,
          label: params.label,
          platform: params.platform,
          modalities: [...params.modalities],
          resourceGroups: [...params.resourceGroups],
          ...(params.artifactUploadEnabled === undefined
            ? {}
            : { artifactUploadEnabled: params.artifactUploadEnabled }),
        },
      }).then((result) => {
        if (result.ok) {
          // The token is returned exactly once; keeping it here is what makes
          // the rest of this client usable without re-pairing.
          token = result.value.token;
        }
        return result;
      }),

    /** `POST /api/generation/runners/claim` — take at most one queued job. */
    claim: (params: {
      deviceId: string;
      resourceGroup: string;
      leaseTtlMs: number;
      modalities: readonly string[];
      now: Date;
    }): Promise<HubRunnerResult<RunnerClaimResponse>> =>
      post<RunnerClaimResponse>({
        path: '/api/generation/runners/claim',
        authenticated: true,
        body: {
          schemaVersion: 1,
          deviceId: params.deviceId,
          resourceGroup: params.resourceGroup,
          // Two clocks: the Hub computes expiry from this and its own `now`
          // rather than trusting either side alone.
          runnerNow: params.now.toISOString(),
          leaseTtlMs: params.leaseTtlMs,
          modalities: [...params.modalities],
        },
      }),

    /** `POST /api/generation/runners/status` — report under the fence. */
    reportStatus: (params: {
      deviceId: string;
      dispatchId: string;
      attempt: number;
      leaseId: string;
      status: GenerationJobStatus;
      candidateCount: number;
      candidateId?: string;
      preparedHash?: string;
      failure?: { code: string; message: string; at: string };
      cancellation?: GenerationJobCancellation;
      now: Date;
    }): Promise<HubRunnerResult<RunnerStatusUpdateResponse>> =>
      post<RunnerStatusUpdateResponse>({
        path: '/api/generation/runners/status',
        authenticated: true,
        body: {
          schemaVersion: 1,
          deviceId: params.deviceId,
          dispatchId: params.dispatchId,
          attempt: params.attempt,
          leaseId: params.leaseId,
          status: params.status,
          candidateCount: params.candidateCount,
          ...(params.candidateId === undefined ? {} : { candidateId: params.candidateId }),
          ...(params.preparedHash === undefined ? {} : { preparedHash: params.preparedHash }),
          ...(params.failure === undefined ? {} : { failure: params.failure }),
          ...(params.cancellation === undefined ? {} : { cancellation: params.cancellation }),
          runnerNow: params.now.toISOString(),
        },
      }),

    /** `POST /api/generation/runners/candidates` — report a finished result. */
    reportCandidate: (params: {
      deviceId: string;
      dispatch: GenerationDispatch;
      fence: GenerationDispatchFence;
      candidateId: string;
      preparedHash: string;
      seed: number;
      engineId?: string;
      mimeType?: string;
      bytes?: number;
      provenanceState: 'full' | 'partial' | 'unknown';
      now: Date;
    }): Promise<HubRunnerResult<{ published: number; candidate: { candidateId: string } }>> =>
      post({
        path: '/api/generation/runners/candidates',
        authenticated: true,
        body: {
          schemaVersion: 1,
          deviceId: params.deviceId,
          dispatchId: params.dispatch.dispatchId,
          attempt: params.fence.attempt,
          leaseId: params.fence.lease.leaseId,
          candidateId: params.candidateId,
          preparedHash: params.preparedHash,
          seed: params.seed,
          ...(params.engineId === undefined ? {} : { engineId: params.engineId }),
          ...(params.mimeType === undefined ? {} : { mimeType: params.mimeType }),
          ...(params.bytes === undefined ? {} : { bytes: params.bytes }),
          provenanceState: params.provenanceState,
          runnerNow: params.now.toISOString(),
        },
      }),

    /** `POST /api/generation/runners/artifact` — request a private upload slot. */
    requestArtifactTicket: (params: {
      deviceId: string;
      dispatch: GenerationDispatch;
      fence: GenerationDispatchFence;
      candidateId: string;
      kind: 'image' | 'audio';
      mimeType: string;
      bytes: number;
      sha256: string;
      now: Date;
    }): Promise<HubRunnerResult<{ ticket: { ticketId: string }; stagingKey: string }>> =>
      post({
        path: '/api/generation/runners/artifact',
        authenticated: true,
        body: {
          schemaVersion: 1,
          deviceId: params.deviceId,
          dispatchId: params.dispatch.dispatchId,
          attempt: params.fence.attempt,
          leaseId: params.fence.lease.leaseId,
          candidateId: params.candidateId,
          kind: params.kind,
          mimeType: params.mimeType,
          bytes: params.bytes,
          sha256: params.sha256,
          runnerNow: params.now.toISOString(),
        },
      }),

    /**
     * `PUT /api/generation/runner-artifacts/:ticketId` — upload the bytes.
     *
     * Not a publication: the Hub stages them privately under an owner-scoped,
     * expiring ticket. If upload is off the request never gets this far — the
     * ticket call answers `upload_disabled` and the caller shows a local-only
     * result with export/import instead.
     */
    uploadArtifact: async (params: {
      ticketId: string;
      mimeType: string;
      bytes: Uint8Array;
    }): Promise<HubRunnerResult<{ sha256: string }>> => {
      if (!token) {
        return {
          ok: false,
          status: 401,
          code: 'unauthorized',
          message: 'this runner has no credential — pair it first',
        };
      }
      let response: Response;
      try {
        response = await doFetch(
          `${options.hubOrigin}/api/generation/runner-artifacts/${params.ticketId}`,
          {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': params.mimeType },
            body: params.bytes,
          },
        );
      } catch (error) {
        return {
          ok: false,
          status: 0,
          code: 'transport_failed',
          message: error instanceof Error ? error.message : 'hub unreachable',
        };
      }
      if (!response.ok) {
        return refusalFrom(response);
      }
      return { ok: true, value: (await response.json()) as { sha256: string } };
    },
  };
};

/** The runner client surface. */
export type HubRunnerClient = ReturnType<typeof createHubRunnerClient>;

/**
 * Whether a refusal means "stop asking".
 *
 * `device_revoked` and `unauthorized` are terminal for this process: retrying
 * would spin against a credential the creator has already withdrawn. Everything
 * else — a lost race, a dropped connection — is retryable.
 */
export const isTerminalRefusal = (refusal: HubRunnerRefusal): boolean =>
  refusal.code === 'device_revoked' || refusal.code === 'unauthorized';

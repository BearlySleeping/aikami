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

import {
  GENERATION_RUNNER_SCHEMA_VERSION,
  GenerationArtifactTicketSchema,
  GenerationCandidateViewSchema,
  GenerationDispatchRejectionCodeSchema,
  RunnerClaimResponseSchema,
  RunnerPairResponseSchema,
  RunnerStatusUpdateResponseSchema,
} from '@aikami/schemas';
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
import { type TSchema, Type } from 'typebox';
import { Value } from 'typebox/value';

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
  /**
   * Abort a Hub request that stalls longer than this. Defaults to 30s so a
   * half-open connection can never hang the runner loop forever.
   */
  requestTimeoutMs?: number;
};

/** The default cancellation timeout for one Hub request. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Hosts for which plain HTTP is acceptable (a developer's own machine). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * Validate the Hub origin before any credential can be attached.
 *
 * A runner presents its bearer credential on every authenticated request, so an
 * `http://` origin that is not loopback would put that credential on the wire in
 * the clear. Reject it here — before the request flow can reach
 * `headers.authorization` — rather than letting a misconfigured origin leak it.
 */
const assertHubOrigin = (raw: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`hubOrigin "${raw}" is not a valid absolute URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`hubOrigin "${raw}" must use http or https`);
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `hubOrigin "${raw}" must use HTTPS unless it points at a loopback host — the runner credential is sent on every authenticated request`,
    );
  }
  return raw;
};

/**
 * The exact bytes of a `Uint8Array` as an `ArrayBuffer`.
 *
 * A bare `Uint8Array` is not assignable to `BodyInit` under every lib this
 * module is compiled against (the DOM and Bun typings disagree), and passing
 * `.buffer` alone would leak the view's byte offset. The slice is the honest
 * copy: same bytes, unambiguous type.
 */
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Parse a refusal body, tolerating anything the Hub (or a proxy) answers. */
const refusalFrom = async (response: Response): Promise<HubRunnerRefusal> => {
  let code: HubRunnerRefusal['code'] = 'transport_failed';
  let message = `hub answered ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      // 🔴 Only a *declared* rejection code is trusted. A proxy or a future
      // server that answers an unknown code must not become an unbounded retry
      // loop: it degrades to the bounded `transport_failed` the loop already
      // knows how to count.
      if (
        typeof body.code === 'string' &&
        Value.Check(GenerationDispatchRejectionCodeSchema, body.code)
      ) {
        code = body.code;
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
 * The declared success shape of a candidate report. There is no shared schema
 * for the envelope, but the wrapped candidate is the shared view.
 */
const RunnerCandidateReportResponseSchema = Type.Object({
  ok: Type.Literal(true),
  candidate: GenerationCandidateViewSchema,
  published: Type.Integer({ minimum: 0 }),
});

/** The declared success shape of an artifact-ticket reply. */
const RunnerArtifactTicketResponseSchema = Type.Object({
  schemaVersion: Type.Literal(GENERATION_RUNNER_SCHEMA_VERSION),
  ticket: GenerationArtifactTicketSchema,
  stagingKey: Type.String({ minLength: 1 }),
});

/** The declared success shape of an artifact upload. */
const RunnerArtifactUploadResponseSchema = Type.Object({
  ok: Type.Literal(true),
  ticketId: Type.String({ minLength: 1 }),
  sha256: Type.String(),
  bytes: Type.Integer({ minimum: 0 }),
});

/** Parse a success body, or `undefined` when it does not match the schema. */
const parseSuccess = <T>(schema: TSchema, value: unknown): T | undefined =>
  Value.Check(schema, value) ? (Value.Parse(schema, value) as T) : undefined;

/**
 * A success status with an unparseable or schema-invalid body.
 *
 * `transport_failed` is deliberate: the runner cannot trust a reply it cannot
 * read, and it is the bounded, retryable code the loop already accounts for.
 */
const malformedResponse = (response: Response): HubRunnerRefusal => ({
  ok: false,
  status: response.status,
  code: 'transport_failed',
  message: 'the hub answered with a body that does not match the runner protocol',
});

/**
 * The transport. One instance per runner process; `token` is held in memory
 * only — the caller decides where (if anywhere) to persist it.
 */
export const createHubRunnerClient = (options: HubRunnerClientOptions) => {
  // 🔴 Validate the origin first: every authenticated request attaches the
  // bearer credential, and `assertHubOrigin` is what stops a non-loopback
  // `http://` origin from receiving it in the clear.
  const hubOrigin = assertHubOrigin(options.hubOrigin);
  const requestTimeoutMs =
    options.requestTimeoutMs !== undefined && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await doFetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  let token = options.token;

  const post = async <T>(params: {
    path: string;
    body?: unknown;
    /** Authenticate as the paired device rather than as a browser session. */
    authenticated?: boolean;
    /** The declared success shape; a mismatch becomes a typed refusal. */
    schema: TSchema;
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
      response = await fetchWithTimeout(`${hubOrigin}${params.path}`, {
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
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return malformedResponse(response);
    }
    const parsed = parseSuccess<T>(params.schema, value);
    return parsed === undefined ? malformedResponse(response) : { ok: true, value: parsed };
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
        schema: RunnerPairResponseSchema,
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
        schema: RunnerClaimResponseSchema,
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
        schema: RunnerStatusUpdateResponseSchema,
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
      post<{ published: number; candidate: { candidateId: string } }>({
        path: '/api/generation/runners/candidates',
        authenticated: true,
        schema: RunnerCandidateReportResponseSchema,
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
      post<{ ticket: { ticketId: string }; stagingKey: string }>({
        path: '/api/generation/runners/artifact',
        authenticated: true,
        schema: RunnerArtifactTicketResponseSchema,
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
        response = await fetchWithTimeout(
          `${hubOrigin}/api/generation/runner-artifacts/${params.ticketId}`,
          {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': params.mimeType },
            // An `ArrayBuffer` (not the `Uint8Array`) — the only `BodyInit`
            // narrowing that is valid under both the DOM and the Bun/Node
            // typings this module is compiled against.
            body: toArrayBuffer(params.bytes),
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
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        return malformedResponse(response);
      }
      const parsed = parseSuccess<{ sha256: string }>(RunnerArtifactUploadResponseSchema, value);
      return parsed === undefined ? malformedResponse(response) : { ok: true, value: parsed };
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

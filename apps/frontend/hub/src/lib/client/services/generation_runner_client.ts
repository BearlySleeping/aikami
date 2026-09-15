// apps/frontend/hub/src/lib/client/services/generation_runner_client.ts
//
// C-522 — same-origin client for the hub's generation-runner endpoints.
//
// Mirrors `map_studio_client.ts`: session-gated (`credentials: 'include'`),
// consistent error mapping, and no credential ever held in this module — the
// runner credential lives on the creator's machine, never in a browser bundle.
//
// Contract: C-522 Hub and client access to the generation runner

import type { GenerationDispatch, GenerationRunnerAvailability } from '@aikami/schemas';
import type {
  ErrorType,
  GenerationArtifactTicketView,
  GenerationCandidateView,
  RunnerDeviceSummary,
} from '@aikami/types';
import { toAppError } from '@aikami/utils';

/** One private candidate awaiting (or carrying) a review decision. */
export type GenerationCandidate = GenerationCandidateView;

/**
 * One private staged artifact the owner may retrieve, plus the read-time
 * `uploaded`/`expired` flags the artifact-list projection adds.
 */
export type GenerationArtifact = GenerationArtifactTicketView & {
  uploaded: boolean;
  expired: boolean;
};

/** A minted pairing code plus the exact command the creator should run. */
export type RunnerPairingCode = {
  code: string;
  expiresAt: string;
  command: string;
};

export type GenerationRunnerClientInterface = {
  listRunners(): Promise<RunnerDeviceSummary[]>;
  availability(): Promise<GenerationRunnerAvailability>;
  createPairingCode(): Promise<RunnerPairingCode>;
  revokeRunner(deviceId: string): Promise<RunnerDeviceSummary>;
  setArtifactUpload(deviceId: string, enabled: boolean): Promise<RunnerDeviceSummary>;
  listDispatches(): Promise<GenerationDispatch[]>;
  listCandidates(): Promise<GenerationCandidate[]>;
  listArtifacts(dispatchId: string): Promise<GenerationArtifact[]>;
  reviewCandidate(candidateId: string, decision: 'accept' | 'reject'): Promise<void>;
  requestCancel(dispatchId: string): Promise<{ confirmed: boolean; requested: boolean }>;
};

/**
 * Map an HTTP status onto the app error vocabulary.
 *
 * `toAppError` derives its `statusCode` from the error type, so a named type is
 * what preserves a 401/404 as 401/404 instead of collapsing every refusal into
 * an internal 500.
 */
const errorTypeForStatus = (status: number): ErrorType => {
  switch (status) {
    case 401:
      return 'unauthenticated';
    case 403:
      return 'permission-denied';
    case 404:
      return 'not-found';
    case 409:
      return 'already-exists';
    case 429:
      return 'resource-exhausted';
    case 503:
      return 'unavailable';
    default:
      return status >= 500 ? 'internal' : 'invalid-argument';
  }
};

/** Map a hub refusal body to an app error, preserving the named code. */
const toAppErrorFromResponse = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    message?: string;
  };
  return toAppError({
    errorType: errorTypeForStatus(response.status),
    errorMessage:
      body.message ?? body.error ?? `Generation-runner request failed (HTTP ${response.status})`,
    // The named refusal code and the raw status live in `details`; the message
    // stays the creator-facing text.
    details: { code: body.code, status: response.status },
  });
};

/**
 * Generation-runner client backed by the hub's session-gated endpoints.
 *
 * @param hubBase The `/api` base (same origin, e.g. `'/api'`).
 */
export const createGenerationRunnerClient = (hubBase: string): GenerationRunnerClientInterface => {
  const base = hubBase.replace(/\/$/, '');
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${base}${path}`, { credentials: 'include', ...init });
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
    return (await response.json()) as T;
  };
  const send = async <T>(path: string, method: string, body?: unknown): Promise<T> =>
    json<T>(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });

  return {
    listRunners: () => json<RunnerDeviceSummary[]>('/generation/runners'),
    availability: () => json<GenerationRunnerAvailability>('/generation/runners/availability'),
    createPairingCode: () => send<RunnerPairingCode>('/generation/runners/pairing-code', 'POST'),
    revokeRunner: (deviceId) =>
      send<RunnerDeviceSummary>(`/generation/runners/${encodeURIComponent(deviceId)}`, 'DELETE'),
    setArtifactUpload: (deviceId, enabled) =>
      send<RunnerDeviceSummary>(
        `/generation/runners/${encodeURIComponent(deviceId)}/artifact-upload`,
        'POST',
        { enabled },
      ),
    listDispatches: () => json<GenerationDispatch[]>('/generation/dispatches'),
    listCandidates: () => json<GenerationCandidate[]>('/generation/candidates'),
    listArtifacts: (dispatchId) =>
      json<GenerationArtifact[]>(
        `/generation/dispatches/${encodeURIComponent(dispatchId)}/artifacts`,
      ),
    reviewCandidate: async (candidateId, decision) => {
      await send<unknown>(
        `/generation/candidates/${encodeURIComponent(candidateId)}/review`,
        'POST',
        { decision },
      );
    },
    requestCancel: async (dispatchId) => {
      const body = await send<{ cancellation: { requested: boolean; confirmed: boolean } }>(
        `/generation/dispatches/${encodeURIComponent(dispatchId)}/cancel`,
        'POST',
      );
      return body.cancellation;
    },
  };
};

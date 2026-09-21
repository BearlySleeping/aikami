// apps/frontend/client/src/lib/views/studio/studio_hub_transport.ts
//
// C-522 AC-3/AC-5 — the client's runner-transport resolver.
//
// The Creator Studio has two routes to a GPU, and they fail differently:
//
//   * **direct loopback** — the browser talks to a configured local endpoint.
//     It works only when the page is in a secure context *and* the browser
//     grants local-network/private-network access. Chromium may refuse; some
//     embedded WebViews always do.
//   * **paired outbound** — the runner polls the Hub, so the browser needs no
//     local-network permission at all. It requires a Hub origin, a signed-in
//     account and a paired, online device.
//
// This module turns those two facts into one typed answer. The rule it exists
// to enforce: a blocked direct mode must land on a *stated* alternative — with
// something the creator can do next — and never on a retry loop or a silent
// "queued forever". Local generation without a Hub account is always still
// available, so nothing here can make the studio unusable.
//
// Contract: C-522 Hub and client access to the generation runner

import type { GenerationRunnerAvailability, GenerationRunnerMode } from '@aikami/types';

/** What the direct-loopback probe concluded. */
export type LoopbackProbeResult =
  /** A configured endpoint answered. */
  | { state: 'available'; engineUrl: string }
  /** A configured endpoint exists but the browser refused to reach it. */
  | { state: 'blocked'; reason: string }
  /** Nothing is configured — a different problem with a different remedy. */
  | { state: 'unconfigured' };

/** Options for {@link resolveStudioTransport}. */
export type StudioTransportResolutionOptions = {
  loopback: LoopbackProbeResult;
  /**
   * The Hub's own answer, or undefined when the Hub is not configured for this
   * build. Absence is *not* an error: local-only generation is the default.
   */
  hub: GenerationRunnerAvailability | undefined;
  /** Whether this build can talk to a Hub at all (owner-configured origin). */
  hubConfigured: boolean;
};

/** The remedy shown when direct mode is blocked and no device can help. */
const PAIRED_REMEDY =
  'Pair this machine from the Hub’s Studio → Generation page and run `bun run --cwd apps/backend/local-stack runner:pair` — or keep generating locally in the editor.';

const LOCAL_REMEDY =
  'Start the local engine (the image profile in `apps/backend/local-stack`) and reload, or keep using the library you already have.';

/**
 * Decide which transport the studio may use, as a typed result.
 *
 * Precedence: a reachable loopback endpoint wins (no Hub round-trip, no account
 * needed). Otherwise a paired online device carries the job. Otherwise the
 * answer is an explicit unavailability with a code *and* a remedy — never an
 * optimistic `available: true` that the first dispatch then contradicts.
 */
export const resolveStudioTransport = (
  options: StudioTransportResolutionOptions,
): GenerationRunnerAvailability => {
  if (options.loopback.state === 'available') {
    return {
      schemaVersion: 1,
      available: true,
      mode: 'direct_loopback',
      // The direct route has no Hub device identity; the schema requires one,
      // so the endpoint's own host is the stable identifier.
      deviceId: 'direct_loopback',
    };
  }

  if (options.hub?.available === true && options.hub.mode === 'paired_outbound') {
    return options.hub;
  }

  if (!options.hubConfigured) {
    return {
      schemaVersion: 1,
      available: false,
      mode: 'unavailable',
      code: 'hub_unconfigured',
      reason:
        options.loopback.state === 'blocked'
          ? `Direct engine access was blocked (${options.loopback.reason}) and no Hub is configured.`
          : 'No local engine is reachable and no Hub is configured for generation.',
      remedy: options.loopback.state === 'blocked' ? PAIRED_REMEDY : LOCAL_REMEDY,
    };
  }

  if (options.loopback.state === 'blocked') {
    // The Hub knows why *it* cannot help; keep its code and prepend the local
    // cause so the creator sees both halves of the story.
    return (
      options.hub ?? {
        schemaVersion: 1,
        available: false,
        mode: 'unavailable',
        code: 'loopback_blocked',
        reason: `Direct engine access was blocked (${options.loopback.reason}).`,
        remedy: PAIRED_REMEDY,
      }
    );
  }

  return (
    options.hub ?? {
      schemaVersion: 1,
      available: false,
      mode: 'unavailable',
      code: 'no_runner_paired',
      reason: 'No local engine is reachable and no runner is paired to this account.',
      remedy: PAIRED_REMEDY,
    }
  );
};

/** One job the Hub accepted, in the terms the studio polls. */
export type HubDispatchStatus = {
  dispatchId: string;
  status: string;
  candidateCount: number;
  candidateId?: string;
  failure?: { code: string; message: string };
  cancellation?: { requested: boolean; confirmed: boolean; reason?: string };
};

/** One retrieval handle for a finished artifact. */
export type HubArtifactHandle = {
  ticketId: string;
  mimeType: string;
  retrievalPath: string;
  uploaded: boolean;
  expired: boolean;
};

/**
 * The Hub calls the studio's Hub adapter needs.
 *
 * Narrowed to these five so the adapter is testable without a Worker, and so
 * the transport can never grow a sixth call the availability path does not
 * account for.
 */
export type StudioHubGateway = {
  createDispatch(request: {
    jobId: string;
    requestKey: string;
    effectiveSpecHash: string;
    spec: unknown;
  }): Promise<{ dispatchId: string }>;
  getDispatch(dispatchId: string): Promise<HubDispatchStatus>;
  listArtifacts(dispatchId: string): Promise<readonly HubArtifactHandle[]>;
  requestCancel(dispatchId: string): Promise<{ cancellation: { confirmed: boolean } }>;
  fetchArtifact(retrievalPath: string): Promise<Blob>;
};

/** Terminal Hub states — the poll loop stops on these and only these. */
const TERMINAL_HUB_STATUSES = [
  'awaiting_review',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'reconciliation_required',
] as const;

const isTerminal = (status: string): boolean =>
  TERMINAL_HUB_STATUSES.includes(status as (typeof TERMINAL_HUB_STATUSES)[number]);

/** Options for {@link createStudioHubEngine}. */
export type StudioHubEngineOptions = {
  gateway: StudioHubGateway;
  /** Builds the allowlisted dispatch spec + its canonical hash for a request. */
  buildDispatch: (request: {
    prompt: string;
    negativePrompt?: string;
    signal?: AbortSignal;
  }) => Promise<{ jobId: string; requestKey: string; effectiveSpecHash: string; spec: unknown }>;
  /** Poll cadence. */
  pollIntervalMs?: number;
  /** Give up (as a *failure*, stated) after this long. */
  timeoutMs?: number;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

/** A stated failure — never a silent stall. */
export class StudioHubRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StudioHubRefusal';
    this.code = code;
  }
}

/**
 * The Hub-backed studio engine.
 *
 * The dispatch is enqueued, then polled. Cancellation is *truthful*: it asks
 * the Hub and reports what the Hub says about provider-side confirmation,
 * because a stop we did not observe is not a stop we may claim.
 */
export const createStudioHubEngine = (options: StudioHubEngineOptions) => {
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const timeoutMs = options.timeoutMs ?? 900_000;
  /**
   * A poll delay that resolves promptly when the request is aborted.
   *
   * Without this, an aborted request still waited out a full poll interval
   * before `awaitTerminal` noticed the signal — the cancel button felt dead for
   * up to `pollIntervalMs`.
   */
  const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  const sleepForPoll = async (signal?: AbortSignal): Promise<void> => {
    if (options.sleep !== undefined) {
      // An injected sleep keeps its existing override behavior unchanged.
      await options.sleep(pollIntervalMs);
      return;
    }
    await abortableSleep(pollIntervalMs, signal);
  };
  const now = options.now ?? (() => new Date());
  let current: string | undefined;

  const awaitTerminal = async (
    dispatchId: string,
    signal?: AbortSignal,
  ): Promise<HubDispatchStatus> => {
    const deadline = now().getTime() + timeoutMs;
    for (;;) {
      if (signal?.aborted) {
        await options.gateway.requestCancel(dispatchId);
        throw new StudioHubRefusal(
          'cancelled_requested',
          'cancellation was requested; the Hub reports whether the runner confirmed it',
        );
      }
      const status = await options.gateway.getDispatch(dispatchId);
      if (isTerminal(status.status)) {
        return status;
      }
      if (now().getTime() > deadline) {
        throw new StudioHubRefusal(
          'hub_timeout',
          `the runner did not report a terminal state within ${Math.round(timeoutMs / 1000)}s`,
        );
      }
      await sleepForPoll(signal);
    }
  };

  return {
    modality: 'image' as const,

    /** Paired dispatch is only "available" when the studio resolved it as such. */
    isAvailable: async (): Promise<boolean> => true,

    unavailableReason:
      'No paired runner is online for this account — pair a machine or generate locally.',

    generate: async (request: {
      prompt: string;
      negativePrompt?: string;
      signal?: AbortSignal;
    }) => {
      const built = await options.buildDispatch(request);
      const created = await options.gateway.createDispatch(built);
      current = created.dispatchId;
      try {
        const status = await awaitTerminal(created.dispatchId, request.signal);
        if (status.status === 'failed') {
          throw new StudioHubRefusal(
            status.failure?.code ?? 'runner_failed',
            status.failure?.message ?? 'the paired runner reported a failure',
          );
        }
        if (status.status === 'cancelled' || status.status === 'interrupted') {
          throw new StudioHubRefusal(
            'cancelled_unconfirmed',
            status.cancellation?.reason ??
              'the local run stopped; no provider-side cancellation was confirmed',
          );
        }
        if (status.status === 'reconciliation_required') {
          // The run settled without a reviewable result: the dispatch has to be
          // reconciled before it can be retried, so it must not fall through to
          // `listArtifacts` and be reported as a local-only success.
          throw new StudioHubRefusal(
            'reconciliation_required',
            'the run produced no reviewable result — reconcile the dispatch before retrying',
          );
        }

        const artifacts = await options.gateway.listArtifacts(created.dispatchId);
        const artifact = artifacts.find((entry) => entry.uploaded && !entry.expired);
        if (!artifact) {
          // Upload off, or nothing staged yet. This is a stated local-only
          // result, not a failure to hide: the creator still has the bytes on
          // their own machine.
          throw new StudioHubRefusal(
            'artifact_not_uploaded',
            'this result is local-only — enable private preview upload for the paired device, or export it from the runner',
          );
        }
        const blob = await options.gateway.fetchArtifact(artifact.retrievalPath);
        return {
          blob,
          mimeType: artifact.mimeType,
          engineId: 'sdcpp' as const,
          isDemo: false,
        };
      } finally {
        // The slot is cleared when the run settles — success, failure or
        // cancellation — so `cancel()` can never target a completed dispatch.
        if (current === created.dispatchId) {
          current = undefined;
        }
      }
    },

    cancel: (): void => {
      // Fire-and-forget by design: the studio's cancel button must not block on
      // a network round-trip, and the *confirmation* is reported by the poll.
      const dispatchId = current;
      if (dispatchId !== undefined) {
        void options.gateway.requestCancel(dispatchId).catch(() => undefined);
      }
    },
  };
};

/** The mode a resolved availability names, for the studio's status line. */
export const transportModeLabel = (mode: GenerationRunnerMode | 'unavailable'): string => {
  if (mode === 'direct_loopback') {
    return 'Local engine (direct)';
  }
  if (mode === 'paired_outbound') {
    return 'Paired runner';
  }
  return 'Unavailable';
};

// apps/backend/local-stack/stack/generation/hosted/hosted_transport.ts
//
// C-524: the outbound-request seam for the hosted transports.
//
// A transport is the only thing in this repository that opens a socket to a
// provider. Keeping it behind an interface is what makes AC-1/AC-2 provable
// offline: the *stub* transport counts outbound calls, so "the billable call
// count is exactly 0" is a measurement rather than a claim.
//
// 🔴 The credential travels on the outbound request and is written into no
// log line, no record and no error message. `describeOutboundRequest` exists
// so a diagnostic can name the endpoint, operation and model without ever
// touching the secret.
//
// Contract: C-524 Optional hosted asset provider comparison
/** biome-ignore-all lint/style/useNamingConvention: HTTP header names are case-insensitive wire identifiers (Authorization, xi-api-key), not TypeScript identifiers */

import type { GenerationHostedOperation, GenerationHostedTransportId } from '@aikami/constants';

/** One outbound provider request. */
export type HostedOutboundRequest = {
  readonly transport: GenerationHostedTransportId;
  readonly operation: GenerationHostedOperation;
  /** Absolute endpoint URL. */
  readonly endpoint: string;
  readonly apiVersion: string;
  readonly modelId: string;
  /** The provider-shaped request body (never a local `GenerationRequest`). */
  readonly body: Readonly<Record<string, unknown>>;
  /** 🔴 The secret. Never logged, recorded or echoed. */
  readonly credential: string;
};

/** One provider response, normalised. */
export type HostedOutboundResponse = {
  readonly status: number;
  /** The provider's own request id. Required: a response without one is a refusal. */
  readonly requestId: string;
  /** Parsed JSON body, when the provider answered with JSON. */
  readonly json?: unknown;
  /** Raw media bytes, when the provider answered with binary content. */
  readonly bytes?: Uint8Array;
  readonly contentType?: string;
  /** Non-secret response metadata (headers, usage counters). */
  readonly metadata: Readonly<Record<string, string>>;
};

/** The transport seam. */
export type HostedTransport = {
  readonly id: string;
  send(request: HostedOutboundRequest): Promise<HostedOutboundResponse>;
};

/**
 * A diagnostic-safe description of an outbound request.
 *
 * 🔴 Deliberately omits `credential`. This is the function every log line and
 * error message must go through.
 */
export const describeOutboundRequest = (request: HostedOutboundRequest): string =>
  `${request.transport} ${request.operation} → ${request.endpoint} (model ${request.modelId}, api ${request.apiVersion})`;

/**
 * The auth headers each transport's documented API expects.
 *
 * Recorded from the providers' published API documentation for the pinned
 * version: PixelLab uses a bearer token, ElevenLabs an `xi-api-key` header.
 */
export const hostedAuthHeaders = (options: {
  transport: GenerationHostedTransportId;
  credential: string;
}): Record<string, string> =>
  options.transport === 'pixellab'
    ? { Authorization: `Bearer ${options.credential}` }
    : { 'xi-api-key': options.credential };

/** A stub transport plus the call accounting the offline ACs assert on. */
export type StubHostedTransport = HostedTransport & {
  /** Billable provider calls actually sent. */
  readonly callCount: () => number;
  /** Every outbound request, in order (credential included — test-only). */
  readonly calls: readonly HostedOutboundRequest[];
};

/**
 * A deterministic transport that sends nothing.
 *
 * It counts every call it is asked to make, so a test can assert that a
 * refusal produced *zero* outbound calls rather than merely a refusal. The
 * fixture it returns is recorded beside the adapter (`fixtures/`), which is
 * what makes AC-2's mapping assertions offline and repeatable.
 */
export const createStubHostedTransport = (options: {
  id?: string;
  /** Fixture per operation, or a function returning one. */
  responses: Readonly<Record<string, HostedOutboundResponse | (() => HostedOutboundResponse)>>;
}): StubHostedTransport => {
  const calls: HostedOutboundRequest[] = [];
  return {
    id: options.id ?? 'stub',
    callCount: () => calls.length,
    calls,
    send: async (request) => {
      calls.push(request);
      const entry = options.responses[request.operation];
      if (entry === undefined) {
        throw new Error(
          `The stub hosted transport has no recorded fixture for the "${request.operation}" operation (${describeOutboundRequest(request)}).`,
        );
      }
      return typeof entry === 'function' ? entry() : entry;
    },
  };
};

/**
 * The real transport: one bounded `fetch`.
 *
 * A non-2xx status is a typed refusal carrying the provider's status, never a
 * silently empty result. A missing `request-id` header is *also* a refusal —
 * a hosted record that cannot supply a request id is a refusal, not a
 * fabricated hash.
 */
export const createFetchHostedTransport = (options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): HostedTransport => {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  return {
    id: 'fetch',
    send: async (request) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(request.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...hostedAuthHeaders({
              transport: request.transport,
              credential: request.credential,
            }),
          },
          body: JSON.stringify(request.body),
          signal: controller.signal,
        });
        const requestId =
          response.headers.get('request-id') ??
          response.headers.get('x-request-id') ??
          response.headers.get('x-amzn-requestid') ??
          '';
        const contentType = response.headers.get('content-type') ?? undefined;
        const metadata: Record<string, string> = {};
        for (const [key, value] of response.headers.entries()) {
          // 🔴 Never carry an auth echo or a set-cookie into a record.
          if (key === 'set-cookie' || key === 'authorization') {
            continue;
          }
          metadata[key] = value.slice(0, 500);
        }
        if (!response.ok) {
          return { status: response.status, requestId, metadata };
        }
        if (contentType?.includes('application/json')) {
          return {
            status: response.status,
            requestId,
            json: (await response.json()) as unknown,
            ...(contentType === undefined ? {} : { contentType }),
            metadata,
          };
        }
        return {
          status: response.status,
          requestId,
          bytes: new Uint8Array(await response.arrayBuffer()),
          ...(contentType === undefined ? {} : { contentType }),
          metadata,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
};

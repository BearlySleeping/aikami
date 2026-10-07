// packages/frontend/ai-gateway/tests/decision_jev_backends.test.ts
//
// Wire parsing is runtime-neutral; READINESS IS NOT (issue #381).
//
// The regression these tests pin is a category error. C-567's probe required
// `/api/version` and enforced Ollama's 0.35.0 floor for every backend speaking
// `jev-v1`. Laya's HTTP route and a hosted Jev endpoint serve the same body and
// have no such route — so every external backend was refused before it was ever
// asked a question. "Speaks this dialect" and "is this runtime" are different
// facts.

import { describe, expect, test } from 'bun:test';
import {
  createSystemOneDecisionAdapter,
  decisionBackendId,
  probeDecisionBackend,
  probeDecisionRuntime,
  redactReason,
  type SystemOneTransport,
} from '../src/lib/decision/index.ts';

const NEVER_ABORT = new AbortController().signal;

/** Builds a transport from a URL → response map, recording every call. */
const transportOf = (
  routes: Readonly<Record<string, { status: number; body: unknown }>>,
  seen: string[] = [],
): SystemOneTransport => ({
  fetch: async (input, init) => {
    seen.push(`${init.method} ${input}`);
    const route = routes[input];
    if (route === undefined) {
      return { status: 404, text: async () => JSON.stringify({ error: 'not found' }) };
    }
    return { status: route.status, text: async () => JSON.stringify(route.body) };
  },
});

/**
 * A backend that echoes back the FIRST criteria key it was offered.
 *
 * Resolving the key from the request rather than hard-coding `o0` is what a real
 * backend does, and it keeps these tests from silently depending on the order
 * the compiler sorts literals in. A fixture that answered a literal instead of
 * a key would pass for the wrong reason.
 */
const echoFirstChoice = (extra: Record<string, unknown> = {}): SystemOneTransport => ({
  fetch: async (_input, init) => {
    const body = JSON.parse(init.body ?? '{}') as {
      questions?: Record<string, { criteria?: Record<string, string> }>;
    };
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(body.questions ?? {})) {
      const first = Object.keys(question.criteria ?? {})[0];
      if (first !== undefined) {
        answers[key] = { type: 'choice', choice: first };
      }
    }
    return {
      status: 200,
      text: async () => JSON.stringify({ model: 'nimble', answers, ...extra }),
    };
  },
});

const LAYA_DECISION = 'http://192.168.1.20:8080/v1/systemone';
const LAYA_MODELS = 'http://192.168.1.20:8080/v1/models';

describe('a generic Jev-compatible endpoint is not refused for lacking Ollama routes', () => {
  test('the probe never requests /api/version on a jev runtime', async () => {
    const seen: string[] = [];
    const transport = transportOf(
      { [LAYA_MODELS]: { status: 200, body: { data: [{ id: 'nimble' }] } } },
      seen,
    );
    const result = await probeDecisionRuntime({
      runtime: 'jev',
      transport,
      endpoints: { decision: LAYA_DECISION, models: LAYA_MODELS },
      model: 'nimble',
      budgetMs: 1_000,
      signal: NEVER_ABORT,
    });
    expect(result.ok).toBe(true);
    expect(seen.some((call) => call.includes('/api/version'))).toBe(false);
    expect(seen.every((call) => call.startsWith('GET '))).toBe(true);
  });

  test('an endpoint with NO version route and NO listing route still probes', async () => {
    const result = await probeDecisionRuntime({
      runtime: 'jev',
      transport: transportOf({}),
      endpoints: { decision: 'http://localhost:9000/v1/systemone' },
      model: 'nimble',
      budgetMs: 1_000,
      signal: NEVER_ABORT,
    });
    expect(result.ok).toBe(true);
  });

  test('a 404 listing is a note, not a refusal', async () => {
    const result = await probeDecisionRuntime({
      runtime: 'jev',
      transport: transportOf({}),
      endpoints: { decision: LAYA_DECISION, models: LAYA_MODELS },
      model: 'nimble',
      budgetMs: 1_000,
      signal: NEVER_ABORT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.notes.join(' ')).toContain('sample inference is the authority');
      expect(result.versionFloorChecked).toBe(false);
    }
  });

  test('an Ollama runtime still refuses a 404 listing, and still checks the version floor', async () => {
    const seen: string[] = [];
    const result = await probeDecisionRuntime({
      runtime: 'ollama',
      transport: transportOf(
        {
          'http://h/api/version': { status: 200, body: { version: '0.36.1' } },
          'http://h/api/tags': { status: 200, body: { models: [{ name: 'llama3' }] } },
        },
        seen,
      ),
      endpoints: {
        decision: 'http://h/v1/systemone',
        version: 'http://h/api/version',
        models: 'http://h/api/tags',
      },
      model: 'nimble',
      budgetMs: 1_000,
      signal: NEVER_ABORT,
    });
    expect(result).toMatchObject({ ok: false, state: 'model-missing' });
    expect(seen).toContain('GET http://h/api/version');
  });

  test('an Ollama runtime with no version endpoint is MISCONFIGURED, not unsupported', async () => {
    const result = await probeDecisionRuntime({
      runtime: 'ollama',
      transport: transportOf({}),
      endpoints: { decision: 'http://h/v1/systemone' },
      model: 'nimble',
      budgetMs: 1_000,
      signal: NEVER_ABORT,
    });
    expect(result).toMatchObject({ ok: false, state: 'misconfigured' });
  });
});

describe('valid wire output on a non-Ollama endpoint works end to end', () => {
  test('a sample inference on a Laya-shaped endpoint reaches `ready`', async () => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'jev',
      endpoints: { decision: LAYA_DECISION },
      model: 'laya-nimble-q4',
      transport: echoFirstChoice(),
      languages: ['en'],
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 2_000,
      signal: NEVER_ABORT,
      requestId: 'laya',
      stateRevision: 0,
    });
    expect(verdict.state).toBe('ready');
    expect(verdict.capability?.runtime).toContain('Jev-compatible');
    expect(verdict.observed?.checkpoint).toBe('laya-nimble-q4');
  });

  test('the same body on an Ollama runtime below the floor is still refused', async () => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'ollama',
      endpoints: { decision: 'http://h/v1/systemone', version: 'http://h/api/version' },
      model: 'nimble',
      languages: ['en'],
      transport: transportOf({
        'http://h/api/version': { status: 200, body: { version: '0.34.3' } },
      }),
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 2_000,
      signal: NEVER_ABORT,
      requestId: 'old',
      stateRevision: 0,
    });
    expect(verdict.state).toBe('unsupported-runtime');
  });
});

describe('backend identity is endpoint-specific', () => {
  test('the same model alias on two endpoints has two identities', () => {
    const laptop = decisionBackendId({
      runtime: 'ollama',
      endpoint: 'http://127.0.0.1:11434/v1/systemone',
      model: 'nimble',
    });
    const hosted = decisionBackendId({
      runtime: 'jev',
      endpoint: 'https://jev.example.com/v1/systemone',
      model: 'nimble',
    });
    const lan = decisionBackendId({
      runtime: 'jev',
      endpoint: 'http://192.168.1.20:8080/v1/systemone',
      model: 'nimble',
    });
    expect(new Set([laptop, hosted, lan]).size).toBe(3);
  });

  test('identity is stable across host case, default ports and trailing slashes', () => {
    const a = decisionBackendId({
      runtime: 'jev',
      endpoint: 'http://Example.COM:8080/v1/systemone/',
      model: 'nimble',
    });
    const b = decisionBackendId({
      runtime: 'jev',
      endpoint: 'http://example.com:8080/v1/systemone',
      model: 'nimble',
    });
    expect(a).toBe(b);
  });

  test('the adapter reports the endpoint-scoped identity in provenance', async () => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'jev',
      endpoints: { decision: LAYA_DECISION },
      model: 'nimble',
      languages: ['en'],
      transport: echoFirstChoice(),
    });
    expect(adapter.backendId).toContain('192.168.1.20:8080');
    expect(adapter.backendId).toContain('#nimble');
  });
});

describe('authentication is first-class and never leaks', () => {
  test('an authenticated sample succeeds and the header is sent', async () => {
    const seenHeaders: Record<string, string>[] = [];
    const echo = echoFirstChoice();
    const transport: SystemOneTransport = {
      fetch: async (input, init) => {
        seenHeaders.push(init.headers);
        return echo.fetch(input, init);
      },
    };
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'jev',
      endpoints: { decision: 'https://jev.example.com/v1/systemone' },
      model: 'jev-hosted',
      languages: ['en'],
      transport,
      authHeaders: async () => ({
        // biome-ignore lint/style/useNamingConvention: verbatim HTTP header name
        Authorization: 'Bearer super-secret-token',
      }),
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 2_000,
      signal: NEVER_ABORT,
      requestId: 'auth',
      stateRevision: 0,
    });
    expect(verdict.state).toBe('ready');
    expect(
      seenHeaders.every((headers) => headers.Authorization === 'Bearer super-secret-token'),
    ).toBe(true);
    // No verdict field carries the credential.
    expect(JSON.stringify(verdict)).not.toContain('super-secret-token');
  });

  test('a rejected credential is reported as unauthorized, never as an old runtime', async () => {
    const transport: SystemOneTransport = {
      fetch: async () => ({ status: 401, text: async () => 'unauthorized' }),
    };
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'jev',
      endpoints: {
        decision: 'https://jev.example.com/v1/systemone',
        models: 'https://jev.example.com/v1/models',
      },
      model: 'jev-hosted',
      languages: ['en'],
      transport,
      authHeaders: async () => ({
        // biome-ignore lint/style/useNamingConvention: verbatim HTTP header name
        Authorization: 'Bearer wrong',
      }),
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 2_000,
      signal: NEVER_ABORT,
      requestId: 'auth-fail',
      stateRevision: 0,
    });
    expect(verdict.state).toBe('unauthorized');
  });

  test('a credential embedded in the endpoint URL is redacted out of every reason', async () => {
    const transport: SystemOneTransport = {
      fetch: async () => ({ status: 500, text: async () => 'boom' }),
    };
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'jev',
      endpoints: { decision: 'https://user:leaked-token@jev.example.com/v1/systemone' },
      model: 'jev-hosted',
      languages: ['en'],
      transport,
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 2_000,
      signal: NEVER_ABORT,
      requestId: 'redact',
      stateRevision: 0,
    });
    expect(verdict.reason).not.toContain('leaked-token');
    expect(redactReason('failed at https://u:pw@host/x')).not.toContain('pw');
  });
});

describe('failure modes the settings UI must surface truthfully', () => {
  test('malformed output is reported as sample-rejected, not as success', async () => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'jev',
      endpoints: { decision: 'http://h/v1/systemone' },
      model: 'nimble',
      languages: ['en'],
      transport: transportOf({
        'http://h/v1/systemone': { status: 200, body: { model: 'nimble', answers: {} } },
      }),
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 2_000,
      signal: NEVER_ABORT,
      requestId: 'malformed',
      stateRevision: 0,
    });
    expect(verdict.state).toBe('sample-rejected');
  });

  test('a checkpoint the runtime does not list is model-missing', async () => {
    const result = await probeDecisionRuntime({
      runtime: 'ollama',
      transport: transportOf({
        'http://h/api/version': { status: 200, body: { version: '0.36.1' } },
        'http://h/api/tags': { status: 200, body: { models: [{ name: 'llama3' }] } },
      }),
      endpoints: {
        decision: 'http://h/v1/systemone',
        version: 'http://h/api/version',
        models: 'http://h/api/tags',
      },
      model: 'nimble',
      budgetMs: 1_000,
      signal: NEVER_ABORT,
    });
    expect(result).toMatchObject({ ok: false, state: 'model-missing' });
  });

  test('cancellation settles the probe rather than orphaning it', async () => {
    const controller = new AbortController();
    const transport: SystemOneTransport = {
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    };
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'jev',
      endpoints: { decision: 'http://h/v1/systemone' },
      model: 'nimble',
      languages: ['en'],
      transport,
    });
    const pending = probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 5_000,
      signal: controller.signal,
      requestId: 'cancel',
      stateRevision: 0,
    });
    controller.abort();
    const verdict = await pending;
    expect(verdict.state).toBe('cancelled');
  });

  test('a checkpoint advertising no scoring capability is capability-missing', async () => {
    const result = await probeDecisionRuntime({
      runtime: 'ollama',
      transport: transportOf({
        'http://h/api/version': { status: 200, body: { version: '0.36.1' } },
        'http://h/api/tags': {
          status: 200,
          body: { models: [{ name: 'nimble', capabilities: ['completion', 'tools'] }] },
        },
      }),
      endpoints: {
        decision: 'http://h/v1/systemone',
        version: 'http://h/api/version',
        models: 'http://h/api/tags',
      },
      model: 'nimble',
      budgetMs: 1_000,
      signal: NEVER_ABORT,
    });
    expect(result).toMatchObject({ ok: false, state: 'capability-missing' });
  });
});

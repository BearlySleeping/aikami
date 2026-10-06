// packages/frontend/ai-gateway/tests/decision_systemone_readiness.test.ts
//
// Contract C-567: dialect-level readiness for the `/v1/systemone` route.
//
// The central regression here is the FALSE-READY bug. C-566's adapter reported
// `ready: true` as soon as `/api/version` answered 200. On the machine this
// was written on, Ollama 0.34.3 answers `/api/version` with 200 and
// `/v1/systemone` with 404 — so that check declared a backend ready that
// cannot answer a single decision. The first test below fails against the old
// behaviour and is the reason this file exists.
//
// Every test drives an injected transport. A mock proves the CONTRACT, never
// what any real model would answer.

import { describe, expect, spyOn, test } from 'bun:test';
import {
  compareDottedVersions,
  createSystemOneDecisionAdapter,
  DECISION_SCORING_CAPABILITY_TOKENS,
  type DecisionAdapter,
  declaresScoring,
  normalizeModelName,
  parseModelListing,
  probeDecisionBackend,
  probeSystemOneBackend,
  SYSTEM_ONE_MIN_RUNTIME_VERSION,
  type SystemOneTransport,
} from '../src/lib/decision/index.ts';

const ENDPOINTS = {
  decision: 'http://127.0.0.1:11434/v1/systemone',
  version: 'http://127.0.0.1:11434/api/version',
  models: 'http://127.0.0.1:11434/api/tags',
};

/** Builds a transport that answers a fixed route table. */
const transportOf = (
  routes: Readonly<Record<string, { status: number; body: unknown }>>,
): SystemOneTransport => ({
  fetch: async (input) => {
    const route = routes[input];
    if (route === undefined) {
      return { status: 404, text: async () => '{"error":"not found"}' };
    }
    return { status: route.status, text: async () => JSON.stringify(route.body) };
  },
});

/** An Ollama-style version route. */
const versionRoute = (version: string): { status: number; body: unknown } => ({
  status: 200,
  body: { version },
});

/** An Ollama-style `/api/tags` listing. */
const tagsRoute = (
  models: readonly { name: string; capabilities?: string[] }[],
): { status: number; body: unknown } => ({ status: 200, body: { models } });

const neverAborted = (): AbortSignal => new AbortController().signal;

describe('version comparison', () => {
  test('orders dotted versions numerically, not lexically', () => {
    // The lexical trap: '0.9.0' > '0.35.0' as strings, which is why this is
    // compared segment-wise.
    expect(compareDottedVersions('0.9.0', '0.35.0')).toBeLessThan(0);
    expect(compareDottedVersions('0.35.0', '0.35.0')).toBe(0);
    expect(compareDottedVersions('0.35.1', '0.35.0')).toBeGreaterThan(0);
    expect(compareDottedVersions('1.0', '0.35.0')).toBeGreaterThan(0);
  });

  test('an unreadable version is not the same answer as a matching one', () => {
    expect(compareDottedVersions('unknown', '0.35.0')).toBeUndefined();
    expect(compareDottedVersions('', '0.35.0')).toBeUndefined();
  });
});

describe('model identity', () => {
  test('tags and case do not make a present checkpoint look missing', () => {
    expect(normalizeModelName('nimble:latest')).toBe(normalizeModelName('nimble'));
    expect(normalizeModelName('NIMBLE')).toBe('nimble');
    expect(normalizeModelName('nimble')).not.toBe(normalizeModelName('nimble2'));
  });

  test('both listing shapes parse', () => {
    expect(parseModelListing({ models: [{ name: 'nimble', capabilities: ['score'] }] })).toEqual([
      { name: 'nimble', capabilities: ['score'] },
    ]);
    expect(parseModelListing({ data: [{ id: 'nimble' }] })).toEqual([{ name: 'nimble' }]);
  });

  test('an unrecognised listing shape yields no models instead of throwing', () => {
    expect(parseModelListing({ unexpected: true })).toEqual([]);
    expect(parseModelListing(null)).toEqual([]);
    expect(parseModelListing('nope')).toEqual([]);
  });
});

describe('scoring capability', () => {
  test('an advertised list is filtered for decision scoring', () => {
    expect(declaresScoring(['completion', 'systemone'])).toBe(true);
    expect(declaresScoring(['tools', 'vision'])).toBe(false);
  });

  test('an unadvertised list is not treated as evidence of scoring', () => {
    expect(declaresScoring(undefined)).toBe(false);
    expect(declaresScoring([])).toBe(false);
  });

  test('the token list is non-empty', () => {
    expect(DECISION_SCORING_CAPABILITY_TOKENS.length).toBeGreaterThan(0);
  });
});

describe('dialect probe', () => {
  test('a runtime below the floor is refused even though its version route answers 200', async () => {
    // This is the real-world failure: 200 on /api/version, 404 on the decision
    // route. Reporting ready here is what made C-566 unable to measure.
    const result = await probeSystemOneBackend({
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.34.3'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'nimble', capabilities: ['score'] }]),
      }),
      endpoints: ENDPOINTS,
      model: 'nimble',
      budgetMs: 1000,
      signal: neverAborted(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.state).toBe('unsupported-runtime');
    expect(result.reason).toContain('0.34.3');
    expect(result.reason).toContain(SYSTEM_ONE_MIN_RUNTIME_VERSION);
  });

  test('a new-enough runtime with the checkpoint absent reports model-missing', async () => {
    const result = await probeSystemOneBackend({
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.35.0'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'llama3', capabilities: ['completion'] }]),
      }),
      endpoints: ENDPOINTS,
      model: 'nimble',
      budgetMs: 1000,
      signal: neverAborted(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.state).toBe('model-missing');
    expect(result.reason).toContain('nimble');
  });

  test('a present checkpoint advertising no scoring capability is capability-missing', async () => {
    const result = await probeSystemOneBackend({
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.36.1'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'nimble', capabilities: ['completion', 'tools'] }]),
      }),
      endpoints: ENDPOINTS,
      model: 'nimble',
      budgetMs: 1000,
      signal: neverAborted(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.state).toBe('capability-missing');
  });

  test('a checkpoint that advertises no capability list at all is not failed', async () => {
    // Absence of evidence is not evidence of absence. The sample decision is
    // the authority on whether this checkpoint can answer.
    const result = await probeSystemOneBackend({
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.36.1'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'nimble' }]),
      }),
      endpoints: ENDPOINTS,
      model: 'nimble',
      budgetMs: 1000,
      signal: neverAborted(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.scoringDeclared).toBe(false);
    expect(result.runtime).toBe('0.36.1');
  });

  test('the checkpoint is matched through a tag', async () => {
    const result = await probeSystemOneBackend({
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.36.1'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'nimble:latest', capabilities: ['systemone'] }]),
      }),
      endpoints: ENDPOINTS,
      model: 'nimble',
      budgetMs: 1000,
      signal: neverAborted(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.listed.name).toBe('nimble:latest');
    expect(result.scoringDeclared).toBe(true);
  });

  test('an unreadable version string is refused rather than assumed new enough', async () => {
    const result = await probeSystemOneBackend({
      transport: transportOf({ [ENDPOINTS.version]: versionRoute('who-knows') }),
      endpoints: ENDPOINTS,
      model: 'nimble',
      budgetMs: 1000,
      signal: neverAborted(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.state).toBe('unsupported-runtime');
  });

  test('an already-cancelled probe never reaches the network', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await probeSystemOneBackend({
      transport: transportOf({ [ENDPOINTS.version]: versionRoute('0.36.1') }),
      endpoints: ENDPOINTS,
      model: 'nimble',
      budgetMs: 1000,
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.state).toBe('cancelled');
  });
});

describe('adapter capability — the false-ready regression', () => {
  test('a 200 on the version route alone does NOT make the adapter ready', async () => {
    // REGRESSION: against C-566 this returned ready: true.
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'ollama',
      endpoints: ENDPOINTS,
      model: 'nimble',
      languages: ['en'],
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.34.3'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'nimble', capabilities: ['score'] }]),
      }),
    });

    const capability = await adapter.capability({
      deadlineAt: Date.now() + 1000,
      signal: neverAborted(),
    });

    expect(capability.ready).toBe(false);
    expect(capability.notReadyReason).toContain('0.34.3');
  });

  test('an endpoint with no decision route at all is not ready', async () => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'ollama',
      endpoints: ENDPOINTS,
      model: 'nimble',
      languages: ['en'],
      // /api/version answers 200; everything else 404s, exactly as an
      // Ollama below the System One floor behaves.
      transport: transportOf({ [ENDPOINTS.version]: versionRoute('0.34.3') }),
    });

    const capability = await adapter.capability({
      deadlineAt: Date.now() + 1000,
      signal: neverAborted(),
    });

    expect(capability.ready).toBe(false);
  });

  test('a fully provisioned backend reports ready and its real runtime', async () => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'ollama',
      endpoints: ENDPOINTS,
      model: 'nimble',
      languages: ['en'],
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.36.1'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'nimble:latest', capabilities: ['systemone'] }]),
      }),
    });

    const capability = await adapter.capability({
      deadlineAt: Date.now() + 1000,
      signal: neverAborted(),
    });

    expect(capability.ready).toBe(true);
    expect(capability.runtime).toBe('0.36.1');
    // The checkpoint is reported as the runtime spells it, not as requested.
    expect(capability.checkpoint).toBe('nimble:latest');
  });

  test('dialect readiness is not checkpoint readiness, and says so', async () => {
    // Ready here means "this endpoint can serve the dialect". Whether the
    // checkpoint can answer is `probeDecisionBackend`'s sample decision.
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'ollama',
      endpoints: { ...ENDPOINTS, models: undefined },
      model: 'nimble',
      languages: ['en'],
      transport: transportOf({ [ENDPOINTS.version]: versionRoute('0.36.1') }),
    });

    const capability = await adapter.capability({
      deadlineAt: Date.now() + 1000,
      signal: neverAborted(),
    });

    expect(capability.ready).toBe(true);
    expect(capability.notReadyReason).toBeUndefined();
  });
});

describe('probe identity and failure boundaries', () => {
  test('explicit model tags and registry ports remain distinct', async () => {
    expect(normalizeModelName('nimble:7b')).not.toBe(normalizeModelName('nimble:3b'));
    expect(normalizeModelName('registry:5000/nimble')).toBe('registry:5000/nimble');
    expect(normalizeModelName('registry:5000/nimble:latest')).toBe(
      normalizeModelName('registry:5000/nimble'),
    );
    expect(normalizeModelName('registry:5000/nimble')).not.toBe(
      normalizeModelName('registry:6000/nimble'),
    );
    const result = await probeSystemOneBackend({
      endpoints: ENDPOINTS,
      model: 'nimble:7b',
      signal: neverAborted(),
      budgetMs: 1000,
      transport: transportOf({
        [ENDPOINTS.version]: versionRoute('0.36.1'),
        [ENDPOINTS.models]: tagsRoute([{ name: 'nimble:3b' }]),
      }),
    });
    expect(result).toMatchObject({ ok: false, state: 'model-missing' });
  });
  test.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [503, 'unreachable'],
  ])('version HTTP %s preserves %s', async (status, state) => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'ollama',
      endpoints: ENDPOINTS,
      model: 'nimble',
      languages: ['en'],
      transport: transportOf({ [ENDPOINTS.version]: { status, body: {} } }),
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 1000,
      signal: neverAborted(),
      requestId: 'failure',
      stateRevision: 0,
    });
    expect(verdict.state).toBe(state);
    expect(verdict.capability?.notReadyState).toBe(state);
  });
  test('a failed version transport remains unreachable', async () => {
    const adapter = createSystemOneDecisionAdapter({
      runtime: 'ollama',
      endpoints: ENDPOINTS,
      model: 'nimble',
      languages: ['en'],
      transport: {
        fetch: async () => {
          throw new Error('connection refused');
        },
      },
    });
    const verdict = await probeDecisionBackend({
      adapter,
      deadlineAt: Date.now() + 1000,
      signal: neverAborted(),
      requestId: 'failure',
      stateRevision: 0,
    });
    expect(verdict.state).toBe('unreachable');
  });
  test('the listing receives only the budget remaining after the version probe', async () => {
    let clock = 0;
    const time = spyOn(performance, 'now').mockImplementation(() => clock);
    const seen: string[] = [];
    try {
      const result = await probeSystemOneBackend({
        endpoints: ENDPOINTS,
        model: 'nimble',
        signal: neverAborted(),
        budgetMs: 100,
        transport: {
          fetch: async (url) => {
            seen.push(url);
            clock = 101;
            return { status: 200, text: async () => JSON.stringify({ version: '0.36.1' }) };
          },
        },
      });
      expect(result).toMatchObject({ ok: false, state: 'deadline-exceeded' });
      expect(seen).toEqual([ENDPOINTS.version]);
    } finally {
      time.mockRestore();
    }
  });
  test.each(['deadline-exceeded', 'cancelled'] as const)(
    'in-flight abort reports %s',
    async (state) => {
      const controller = new AbortController();
      const result = await probeSystemOneBackend({
        endpoints: ENDPOINTS,
        model: 'nimble',
        signal: controller.signal,
        budgetMs: 10,
        transport: {
          fetch: async (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => reject(new Error('aborted')), {
                once: true,
              });
              if (state === 'cancelled') {
                controller.abort();
              }
            }),
        },
      });
      expect(result).toMatchObject({ ok: false, state });
    },
  );
});

describe('legacy adapters that supply prose only', () => {
  /**
   * A backend that predates the typed `notReadyState` seam and reports only a
   * human-readable reason. The classifier must still be correct for it: these
   * are the states a UI shows an operator, and a wrong one sends them to fix
   * something that is not broken.
   */
  const proseOnlyAdapter = (reason: string): DecisionAdapter => ({
    backendId: 'legacy-backend',
    dialect: 'jev-v1',
    capability: async () => ({
      backendId: 'legacy-backend',
      dialect: 'jev-v1',
      ready: false,
      notReadyReason: reason,
      primitives: ['choice'],
      maxOptions: 64,
      maxQuestions: 16,
      maxContextBytes: 65_536,
      languages: ['en'],
    }),
    run: async () => ({
      ok: false as const,
      reason: 'backend-unavailable' as const,
      detail: reason,
      queueMs: 0,
      inferenceMs: 0,
    }),
  });

  const classify = async (reason: string): Promise<string> => {
    const verdict = await probeDecisionBackend({
      adapter: proseOnlyAdapter(reason),
      deadlineAt: Date.now() + 1000,
      signal: neverAborted(),
      requestId: 'legacy',
      stateRevision: 0,
    });
    return verdict.state;
  };

  // Every one of these reasons contains the word "version", because they all
  // come from the version probe. A version-first classifier reported them all
  // as `unsupported-runtime` — i.e. "upgrade your runtime" for what are
  // actually credential, routing and connectivity problems.
  test('auth failures are not reported as an out-of-date runtime', async () => {
    expect(await classify('runtime version probe returned HTTP 401')).toBe('unauthorized');
    expect(await classify('runtime version probe returned HTTP 403')).toBe('unauthorized');
  });

  test('a missing route or refused connection is unreachable', async () => {
    expect(await classify('runtime version probe returned HTTP 404')).toBe('unreachable');
    expect(await classify('runtime version probe returned HTTP 502')).toBe('unreachable');
    expect(await classify('runtime version probe failed: ECONNREFUSED')).toBe('unreachable');
  });

  test('timeout and cancellation keep their own states', async () => {
    expect(await classify('probe exceeded its 200 ms slice')).toBe('deadline-exceeded');
    expect(await classify('cancelled during probe')).toBe('cancelled');
  });

  test('a genuinely old runtime is still reported as unsupported-runtime', async () => {
    expect(
      await classify('runtime 0.34.3 is older than the 0.35.0 floor required by /v1/systemone'),
    ).toBe('unsupported-runtime');
  });

  test('a missing checkpoint is still reported as model-missing', async () => {
    expect(
      await classify('checkpoint "nimble" is not installed; the runtime lists 14 model(s)'),
    ).toBe('model-missing');
  });

  test('an absent scoring capability is still reported as capability-missing', async () => {
    expect(
      await classify(
        'checkpoint "nimble" advertises [completion, tools], none of which is decision scoring',
      ),
    ).toBe('capability-missing');
  });
});

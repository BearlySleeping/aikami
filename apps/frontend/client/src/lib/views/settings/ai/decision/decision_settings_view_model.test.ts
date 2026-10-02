// apps/frontend/client/src/lib/views/settings/ai/decision/decision_settings_view_model.test.ts
//
// The product configuration path, exercised without a socket (issue #381).
//
// These are the regressions that keep a settings selection from quietly
// activating something it was never measured for. Every backend here is an
// injected stub: no test in this file opens a connection, reads the vault or
// touches localStorage.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DECISION_PROVIDERS } from '@aikami/constants';
import { setDialogCapabilities } from '@aikami/frontend/services/base';
import type { AiConnection, AiProvider } from '@aikami/types';
import {
  decisionGameplayRouting,
  deriveDecisionBackendState,
} from '../../../../services/ai/decision/decision_backend_logic';
import type { DecisionBackendServiceInterface } from '../../../../services/ai/decision_backend_service.svelte';
import {
  createDecisionSettingsViewModel,
  type DecisionSettingsConfigCapabilities,
  decisionSaveBlocker,
} from './decision_settings_view_model.svelte';

// ── Fixtures ────────────────────────────────────────────────────────────

/** A provider row as the config service would return it. */
const provider = (overrides: Partial<AiProvider> = {}): AiProvider => ({
  id: 'provider-1',
  registryId: 'jev-external',
  label: 'Jev-compatible server (local)',
  source: 'stored',
  baseUrl: 'http://127.0.0.1:8080',
  ...overrides,
});

/** A decision connection as the config service would return it. */
const decisionConnection = (overrides: Partial<AiConnection> = {}): AiConnection =>
  ({
    id: 'connection-1',
    providerId: 'provider-1',
    capability: 'decision',
    label: 'Laya · laya-nimble-q4',
    model: 'laya-nimble-q4',
    params: { checkpoint: 'laya-nimble-q4', runtime: 'jev', languages: ['en'] },
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    ...overrides,
  }) as AiConnection;

type ConfigHarness = DecisionSettingsConfigCapabilities & {
  readonly providers: AiProvider[];
  readonly connections: AiConnection[];
  readonly roles: Partial<Record<'decisions', string>>;
  readonly saves: number;
  readonly clearedRoles: string[];
};

const harness = (
  seed: {
    providers?: AiProvider[];
    connections?: AiConnection[];
    roles?: Record<'decisions', string>;
  } = {},
): ConfigHarness => {
  const providers = [...(seed.providers ?? [])];
  const connections = [...(seed.connections ?? [])];
  const roles: Partial<Record<'decisions', string>> = { ...(seed.roles ?? {}) };
  const clearedRoles: string[] = [];
  let saves = 0;
  const self = {
    get providers() {
      return providers;
    },
    get connections() {
      return connections;
    },
    get roles() {
      return roles;
    },
    get saves() {
      return saves;
    },
    clearedRoles,
    getProviders: () => providers,
    getAiConnections: () => connections,
    addProvider: (fields: Parameters<DecisionSettingsConfigCapabilities['addProvider']>[0]) => {
      const id = `provider-${providers.length + 1}`;
      providers.push({ ...fields, id });
      return id;
    },
    updateProvider: (id: string, patch: Partial<Omit<AiProvider, 'id'>>) => {
      const index = providers.findIndex((candidate) => candidate.id === id);
      const current = providers[index];
      if (index >= 0 && current) {
        providers[index] = { ...current, ...patch };
      }
    },
    updateAiConnection: (id: string, patch: Partial<Omit<AiConnection, 'id' | 'createdAt'>>) => {
      const index = connections.findIndex((candidate) => candidate.id === id);
      const current = connections[index];
      if (current) {
        connections[index] = { ...current, ...patch };
      }
    },
    deleteAiConnection: (id: string) => {
      const index = connections.findIndex((candidate) => candidate.id === id);
      if (index >= 0) {
        connections.splice(index, 1);
      }
    },
    addAiConnection: (
      connection: Parameters<DecisionSettingsConfigCapabilities['addAiConnection']>[0],
    ) => {
      const id = `connection-${connections.length + 1}`;
      connections.push({ ...connection, id } as unknown as AiConnection);
      return id;
    },
    setRoleAssignment: (_role, connectionId) => {
      roles.decisions = connectionId;
    },
    clearRoleAssignment: (role) => {
      clearedRoles.push(role);
      delete roles.decisions;
    },
    save: async () => {
      saves += 1;
    },
  };
  return self;
};

/** A backend-service stub whose probe returns a canned verdict. */
/** The backend a saved configuration resolves to. */
const resolvedBackend = (overrides: Record<string, unknown> = {}) => ({
  connectionId: 'connection-1',
  registryId: 'jev-external',
  endpoint: 'http://127.0.0.1:8080',
  checkpoint: 'laya-nimble-q4',
  runtime: 'jev' as const,
  languages: ['en'] as const,
  qualifiedForGameplay: false,
  ...overrides,
});

/** Canned verdicts the stub can report. */
const VERDICTS = {
  ready: { state: 'ready', reason: 'canned ready' },
  unreachable: { state: 'unreachable', reason: 'canned unreachable' },
  unauthorized: { state: 'unauthorized', reason: 'canned unauthorized' },
} as const;

/**
 * A stub implementing the service interface.
 *
 * The section depends on the INTERFACE, not the class, so a unit test of the
 * section never constructs a service, never reaches a socket and never reads
 * the vault. The pure logic the class delegates to — the state projection, the
 * gameplay gate and the staleness rule — is imported from the logic module and
 * used HERE, so the stub computes its own state exactly as the class would.
 */
const stubDecisions = (
  options: {
    /** `null` models an unconfigured capability. */
    backend?: ReturnType<typeof resolvedBackend> | null;
    /** The verdict `test()` produces. Omit to make `test()` produce nothing. */
    verdict?: (typeof VERDICTS)[keyof typeof VERDICTS] | undefined;
    /** Start already holding this verdict, as if a test had just run. */
    initialVerdict?: (typeof VERDICTS)[keyof typeof VERDICTS] | undefined;
  } = {},
): DecisionBackendServiceInterface => {
  const backend = options.backend === null ? undefined : (options.backend ?? resolvedBackend());
  // Stateful, because invalidation is behaviour under test: `invalidate()` must
  // drop the verdict, or a green result would survive an edit to the draft.
  const canned = options.verdict ?? options.initialVerdict;
  let current =
    options.initialVerdict === undefined
      ? undefined
      : ({
          ...options.initialVerdict,
          observed: { checkpoint: 'laya-nimble-q4', sampleMs: 12 },
        } as NonNullable<DecisionBackendServiceInterface['lastVerdict']>);
  const verdictOf = (): DecisionBackendServiceInterface['lastVerdict'] => current;
  const produced = (): NonNullable<DecisionBackendServiceInterface['lastVerdict']> =>
    ({
      ...canned,
      observed: { checkpoint: 'laya-nimble-q4', sampleMs: 12 },
    }) as NonNullable<DecisionBackendServiceInterface['lastVerdict']>;
  const workloadQualified = backend?.qualifiedForGameplay === true;
  const state = (): 'disabled' | 'ready' | 'qualified' =>
    backend === undefined
      ? 'disabled'
      : deriveDecisionBackendState({
          configured: true,
          enabled: true,
          ...(verdictOf() === undefined ? {} : { verdict: verdictOf() }),
          workloadQualified,
        });
  return {
    get lastVerdict() {
      return verdictOf();
    },
    isTesting: false,
    resolve: () => backend,
    summary: () =>
      backend === undefined
        ? {
            configured: false,
            enabled: false,
            state: 'disabled',
            runtimeLabel: '—',
            endpointLabel: '—',
            checkpoint: '—',
            hasCredential: false,
            tasks: [],
          }
        : {
            configured: true,
            enabled: true,
            state: state(),
            runtimeLabel: backend.runtime,
            endpointLabel: backend.endpoint,
            checkpoint: backend.checkpoint,
            hasCredential: backend.credential !== undefined,
            tasks: [{ id: 't', label: 'l', description: 'd', qualified: workloadQualified }],
          },
    gameplayRouting: () =>
      decisionGameplayRouting({
        configured: backend !== undefined,
        enabled: backend !== undefined,
        state: state(),
        workloadQualified,
      }),
    test: async () => {
      if (backend === undefined || canned === undefined) {
        return undefined;
      }
      current = produced();
      return { verdict: current, steps: [] };
    },
    invalidate: () => {
      current = undefined;
    },
    persist: async () => {},
  };
};

const buildViewModel = (config: DecisionSettingsConfigCapabilities, decisions = stubDecisions()) =>
  createDecisionSettingsViewModel({ className: 'DecisionSettingsViewModel', config, decisions });

// ── Dialog seam ──────────────────────────────────────────────────────────

const previousDialogCapabilities: Array<ReturnType<typeof setDialogCapabilities>> = [];

beforeEach(() => {
  previousDialogCapabilities.push(
    setDialogCapabilities({
      showSnackbar: () => {},
      showConditionalSnackbar: () => {},
      setAppLoading: () => {},
      open: async () => undefined,
    }),
  );
});

afterEach(() => {
  setDialogCapabilities(previousDialogCapabilities.pop());
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('the save gate', () => {
  test('an unknown backend, endpoint or checkpoint blocks the save with a reason', () => {
    const laya = DECISION_PROVIDERS.find((entry) => entry.id === 'jev-external');
    expect(
      decisionSaveBlocker(
        { registryId: 'x', endpoint: '', checkpoint: '', credential: '' },
        undefined,
      ),
    ).toContain('Choose a decision backend');
    expect(
      decisionSaveBlocker(
        { registryId: 'jev-external', endpoint: '', checkpoint: '', credential: '' },
        laya,
      ),
    ).toContain('endpoint');
    expect(
      decisionSaveBlocker(
        { registryId: 'jev-external', endpoint: 'http://h', checkpoint: '  ', credential: '' },
        laya,
      ),
    ).toContain('decision checkpoint');
  });

  test('a provider that needs a key refuses to save without one', () => {
    const hosted = DECISION_PROVIDERS.find((entry) => entry.id === 'jev-hosted');
    expect(
      decisionSaveBlocker(
        {
          registryId: 'jev-hosted',
          endpoint: 'https://jev.example.com',
          checkpoint: 'jev',
          credential: '',
        },
        hosted,
      ),
    ).toContain('API key');
    expect(
      decisionSaveBlocker(
        {
          registryId: 'jev-hosted',
          endpoint: 'https://jev.example.com',
          checkpoint: 'jev',
          credential: 'secret',
        },
        hosted,
      ),
    ).toBeUndefined();
  });

  test('a keyless local endpoint saves without a credential', () => {
    const ollama = DECISION_PROVIDERS.find((entry) => entry.id === 'ollama');
    expect(
      decisionSaveBlocker(
        {
          registryId: 'ollama',
          endpoint: 'http://127.0.0.1:11434',
          checkpoint: 'nimble',
          credential: '',
        },
        ollama,
      ),
    ).toBeUndefined();
  });
});

describe('configure', () => {
  test('saving an edited checkpoint updates the reused connection and clears qualification', async () => {
    const config = harness({
      providers: [provider()],
      connections: [
        decisionConnection({
          params: { checkpoint: 'old', runtime: 'jev', qualifiedForGameplay: true },
        }),
      ],
    });
    const viewModel = buildViewModel(config, stubDecisions());
    await viewModel.initialize();
    viewModel.setCheckpoint('new-checkpoint');
    await viewModel.save();

    expect(config.connections).toHaveLength(1);
    expect(config.connections[0]).toMatchObject({
      id: 'connection-1',
      providerId: 'provider-1',
      model: 'new-checkpoint',
      params: {
        checkpoint: 'new-checkpoint',
        runtime: 'jev',
        languages: ['en'],
        qualifiedForGameplay: false,
      },
    });
    expect(config.connections[0]?.label).toContain('new-checkpoint');
    expect(config.roles.decisions).toBe('connection-1');
    expect(config.saves).toBe(1);
  });

  test('saving writes a provider, a decision connection and the decisions role', async () => {
    const config = harness();
    const viewModel = buildViewModel(config);
    await viewModel.initialize();

    viewModel.setProvider('jev-external');
    viewModel.setEndpoint('http://127.0.0.1:8080/');
    viewModel.setCheckpoint('laya-nimble-q4');
    await viewModel.save();

    expect(config.providers).toHaveLength(1);
    expect(config.connections).toHaveLength(1);
    expect(config.connections[0]?.capability).toBe('decision');
    expect(config.roles.decisions).toBe(config.connections[0]?.id);
    expect(config.saves).toBe(1);
  });

  test('the saved connection carries the checkpoint as a DECISION checkpoint, not a chat model', async () => {
    const config = harness();
    const viewModel = buildViewModel(config);
    viewModel.setProvider('ollama');
    viewModel.setEndpoint('http://127.0.0.1:11434');
    viewModel.setCheckpoint('nimble');
    await viewModel.save();

    const params = config.connections[0]?.params as Record<string, unknown>;
    expect(params.checkpoint).toBe('nimble');
    expect(params.runtime).toBe('ollama');
    // The chat editor's knobs have no place on a decision connection.
    expect(params.temperature).toBeUndefined();
    expect(params.maxTokens).toBeUndefined();
  });

  test('a settings selection NEVER marks a backend qualified for gameplay', async () => {
    const config = harness();
    const viewModel = buildViewModel(config);
    viewModel.setProvider('jev-external');
    viewModel.setEndpoint('http://127.0.0.1:8080');
    viewModel.setCheckpoint('laya-nimble-q4');
    await viewModel.save();

    const params = config.connections[0]?.params as Record<string, unknown>;
    expect(params.qualifiedForGameplay).toBe(false);
  });

  test('re-saving the same endpoint reuses the stored account instead of forking a second row', async () => {
    const config = harness();
    const viewModel = buildViewModel(config);
    viewModel.setProvider('jev-external');
    viewModel.setEndpoint('http://127.0.0.1:8080');
    viewModel.setCheckpoint('laya-nimble-q4');
    await viewModel.save();
    await viewModel.save();

    expect(config.providers).toHaveLength(1);
    expect(config.connections).toHaveLength(1);
  });

  test('a different endpoint is a different account, and says so through two rows', async () => {
    const config = harness();
    const viewModel = buildViewModel(config);
    viewModel.setProvider('jev-external');
    viewModel.setEndpoint('http://127.0.0.1:8080');
    viewModel.setCheckpoint('laya-nimble-q4');
    await viewModel.save();
    viewModel.setEndpoint('http://192.168.1.20:9090');
    viewModel.setCheckpoint('laya-nimble-q4');
    await viewModel.save();

    expect(config.providers).toHaveLength(2);
  });

  test('a blocked draft saves nothing and explains why', async () => {
    const config = harness();
    const viewModel = buildViewModel(config);
    viewModel.setProvider('jev-hosted');
    viewModel.setEndpoint('https://jev.example.com');
    viewModel.setCheckpoint('jev');
    await viewModel.save();

    expect(config.providers).toHaveLength(0);
    expect(config.saves).toBe(0);
    expect(viewModel.errorMessage).toContain('API key');
  });
});

describe('test and sample inference', () => {
  test('a reachable backend reports a real sample decision and becomes `ready`', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    const viewModel = buildViewModel(config, stubDecisions({ verdict: VERDICTS.ready }));
    await viewModel.test();

    expect(viewModel.summary.state).toBe('ready');
    expect(viewModel.readinessMessage).toContain('sample decision');
    // `ready` is explicitly not `qualified`.
    expect(viewModel.stateDescriptor.state).toBe('ready');
    expect(viewModel.stateDescriptor.label).not.toContain('Qualified');
  });

  test('a rejected credential is user-visible and does not become ready', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    const viewModel = buildViewModel(config, stubDecisions({ verdict: VERDICTS.unauthorized }));
    await viewModel.test();

    expect(viewModel.summary.state).toBe('disabled');
    expect(viewModel.readinessMessage).toContain('refused the stored credential');
  });

  test('an unreachable endpoint is user-visible with an actionable sentence', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    const viewModel = buildViewModel(config, stubDecisions({ verdict: VERDICTS.unreachable }));
    await viewModel.test();

    expect(viewModel.readinessMessage).toContain('Check the URL');
  });

  test('testing before saving is refused rather than probing nothing', async () => {
    const viewModel = buildViewModel(harness(), stubDecisions({ backend: null }));
    await viewModel.test();
    expect(viewModel.errorMessage).toContain('Save a backend before testing');
    expect(viewModel.readinessMessage).toBeUndefined();
  });

  test('editing the draft invalidates a previous green result', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    const viewModel = buildViewModel(config, stubDecisions({ verdict: VERDICTS.ready }));
    await viewModel.test();
    expect(viewModel.summary.state).toBe('ready');

    viewModel.setCheckpoint('some-other-checkpoint');
    expect(viewModel.summary.state).toBe('disabled');
  });
});

describe('the automatic-gameplay gate', () => {
  test('no settings selection activates an unqualified gameplay task', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    const viewModel = buildViewModel(config, stubDecisions({ verdict: VERDICTS.ready }));
    await viewModel.test();

    expect(viewModel.gameplayRouting.allowed).toBe(false);
    expect(viewModel.gameplayRouting.reason).toBeTruthy();
    expect(viewModel.summary.tasks.every((task) => task.qualified === false)).toBe(true);
  });

  test('the routing decision is made in code, and names what is missing', async () => {
    const viewModel = buildViewModel(harness(), stubDecisions({ backend: null }));
    // Not configured at all.
    expect(viewModel.gameplayRouting.reason).toContain('no decision backend');
  });
});

describe('disable and reload', () => {
  test('disable clears the role, persists, and returns the section to disabled', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    const viewModel = buildViewModel(config, stubDecisions({ verdict: VERDICTS.ready }));
    await viewModel.initialize();
    expect(viewModel.configured).toBe(true);

    await viewModel.disable();

    expect(config.clearedRoles).toEqual(['decisions']);
    expect(config.roles.decisions).toBeUndefined();
    expect(config.saves).toBe(1);
    expect(viewModel.summary.state).toBe('disabled');
  });

  test('initialize reloads the saved configuration into the draft', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    const viewModel = buildViewModel(config, stubDecisions());
    await viewModel.initialize();

    expect(viewModel.draft.registryId).toBe('jev-external');
    expect(viewModel.draft.endpoint).toBe('http://127.0.0.1:8080');
    expect(viewModel.draft.checkpoint).toBe('laya-nimble-q4');
  });

  test('nothing is probed on load', async () => {
    const config = harness({
      providers: [provider()],
      connections: [decisionConnection()],
      roles: { decisions: 'connection-1' },
    });
    // The stub reports a verdict only when `test()` is called, so a `ready`
    // state after `initialize()` would mean the section probed on load.
    const viewModel = buildViewModel(config, stubDecisions());
    await viewModel.initialize();
    expect(viewModel.summary.state).toBe('disabled');
    expect(viewModel.readinessMessage).toBeUndefined();
  });
});

describe('the provider picker', () => {
  test('documentation and credential toggles expose presentation values', () => {
    const viewModel = buildViewModel(harness(), stubDecisions());
    expect(viewModel.showDocs).toBe(false);
    viewModel.toggleDocs();
    expect(viewModel.showDocs).toBe(true);
    expect(viewModel.docsToggleLabel).toBe('Hide setup link');
    viewModel.setProvider('ollama');
    expect(viewModel.showDocs).toBe(false);
    viewModel.toggleDocs();
    expect(viewModel.showDocs).toBe(true);
    viewModel.toggleDocs();
    expect(viewModel.showDocs).toBe(false);
    expect(viewModel.credentialInputType).toBe('password');
    viewModel.toggleCredential();
    expect(viewModel.credentialInputType).toBe('text');
    expect(viewModel.credentialToggleLabel).toBe('Hide');
  });

  test('every registry entry is offered with its runtime and docs', () => {
    const viewModel = buildViewModel(harness(), stubDecisions());
    const ids = viewModel.providerOptions.map((option) => option.id);
    expect(ids).toContain('ollama');
    expect(ids).toContain('jev-external');
    expect(ids).toContain('jev-hosted');
    for (const option of viewModel.providerOptions) {
      expect(option.docsUrl).toMatch(/^https:\/\//);
    }
  });

  test('the Ollama entry defaults to the local daemon and declares its own runtime', () => {
    const viewModel = buildViewModel(harness(), stubDecisions());
    const ollama = viewModel.providerOptions.find((option) => option.id === 'ollama');
    expect(ollama?.defaultUrl).toBe('http://127.0.0.1:11434');
    expect(ollama?.runtime).toBe('ollama');
    // Reusing the daemon does not mean a chat model becomes a decision model.
    expect(ollama?.needsKey).toBe(false);
  });
});

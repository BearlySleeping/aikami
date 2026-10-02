// apps/frontend/client/src/lib/views/settings/ai/decision/decision_settings_view_model.svelte.ts
//
// ViewModel for Settings → Decisions / System One (issue #381).
//
// The user outcome this exists for: a player can CONFIGURE a decision backend,
// TEST it with a real sample inference, read an honest readiness reason, and
// DISABLE it again — with save and reload working, and with no settings
// selection quietly switching a gameplay call onto a model that was never
// measured.
//
// The form is self-contained rather than a branch inside the shared AI
// connection editor, for one reason: a decision connection's parameters are a
// checkpoint and a runtime, not temperature and a context size. Reusing the chat
// editor's shape would have made "decision" look like a text model with a
// smaller context window, which is precisely the conflation this subsystem
// refuses everywhere else.

import {
  DECISION_PROVIDERS,
  type DecisionProviderDescriptor,
  decisionProviderEntry,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { AiConnection, AiProvider } from '@aikami/types';
import type { ConnectionCapability } from '$types';
import type {
  DecisionBackendSummary,
  DecisionGameplayRouting,
  DecisionTestOutcome,
} from '../../../../services/ai/decision/types';
import type { DecisionBackendServiceInterface } from '../../../../services/ai/decision_backend_service.svelte';
import { normalizeEndpoint, planProviderAccount } from '../ai_provider_account';
import {
  type DecisionProviderOption,
  type DecisionStateDescriptor,
  decisionProviderOptions,
  decisionReadinessCopy,
  describeDecisionState,
} from './decision_settings_section';

/** The draft a player edits. */
export type DecisionDraft = {
  /** Registry id from {@link DECISION_PROVIDERS}. */
  readonly registryId: string;
  readonly endpoint: string;
  /** Checkpoint identity, e.g. `nimble` or `laya-nimble-q4`. */
  readonly checkpoint: string;
  readonly credential: string;
};

/** Configuration surface the section writes through. */
export type DecisionSettingsConfigCapabilities = {
  readonly getProviders: () => readonly AiProvider[];
  readonly getAiConnections: () => readonly AiConnection[];
  readonly addProvider: (fields: {
    registryId: string;
    label: string;
    credential?: string;
    baseUrl?: string;
    source: 'stored';
  }) => string;
  readonly updateProvider: (id: string, patch: Partial<Omit<AiProvider, 'id'>>) => void;
  readonly deleteAiConnection: (id: string) => void;
  readonly addAiConnection: (connection: {
    providerId: string;
    capability: ConnectionCapability;
    label: string;
    model: string;
    params: {
      checkpoint: string;
      runtime: 'ollama' | 'jev';
      languages?: ('en' | 'multi')[];
      qualifiedForGameplay?: boolean;
    };
  }) => string;
  readonly setRoleAssignment: (role: 'decisions', connectionId: string) => void;
  readonly clearRoleAssignment: (role: 'decisions') => void;
  readonly save: () => Promise<void>;
};

/** Options accepted by the ViewModel. */
export type DecisionSettingsViewModelOptions = BaseViewModelOptions & {
  readonly config: DecisionSettingsConfigCapabilities;
  readonly decisions: DecisionBackendServiceInterface;
};

/** Public surface of the section. */
export type DecisionSettingsViewModelInterface = BaseViewModelInterface & {
  /** The section heading. */
  readonly title: string;
  /** What the section is for, in one sentence. */
  readonly subtitle: string;
  /** Provider rows for the picker. */
  readonly providerOptions: readonly DecisionProviderOption[];
  /** The current draft. */
  readonly draft: DecisionDraft;
  /** Whether the draft's provider needs a key field, and whether it is optional. */
  readonly credentialRequired: boolean;
  readonly credentialOptional: boolean;
  /** Why saving is blocked right now, or undefined when it is not. */
  readonly saveBlockedReason: string | undefined;
  /** Whether a backend is configured and enabled. */
  readonly configured: boolean;
  readonly stateDescriptor: DecisionStateDescriptor;
  readonly summary: DecisionBackendSummary;
  /** Ordered, credential-free setup steps from the last test. */
  readonly setupSteps: readonly { readonly id: string; readonly detail: string }[];
  /** The readiness sentence for the last test. */
  readonly readinessMessage: string | undefined;
  /** Whether automatic gameplay routing would be permitted, and why not. */
  readonly gameplayRouting: DecisionGameplayRouting;
  readonly isTesting: boolean;
  setProvider(registryId: string): void;
  setEndpoint(endpoint: string): void;
  setCheckpoint(checkpoint: string): void;
  setCredential(credential: string): void;
  save(): Promise<void>;
  test(): Promise<void>;
  disable(): Promise<void>;
  reset(): void;
};

/** An empty draft for a provider. */
const draftFor = (registryId: string): DecisionDraft => ({
  registryId,
  endpoint: decisionProviderEntry(registryId)?.defaultUrl ?? '',
  checkpoint: '',
  credential: '',
});

/**
 * Why a draft cannot be saved, or undefined.
 *
 * Exported because the rule is the point: an endpoint and a checkpoint are
 * mandatory, and a credential is mandatory only for the providers that declare
 * one. Nothing else blocks a save — a player may save a backend they have not
 * tested, and the section will say so rather than pretending it works.
 */
export const decisionSaveBlocker = (
  draft: DecisionDraft,
  provider: DecisionProviderDescriptor | undefined,
): string | undefined => {
  if (provider === undefined) {
    return 'Choose a decision backend.';
  }
  if (normalizeEndpoint(draft.endpoint).length === 0) {
    return 'Enter the endpoint the decision server is served from.';
  }
  if (draft.checkpoint.trim().length === 0) {
    return 'Enter the decision checkpoint. A chat model cannot answer bounded decisions.';
  }
  if (provider.needsKey && draft.credential.trim().length === 0) {
    return 'This backend needs an API key.';
  }
  return undefined;
};

class DecisionSettingsViewModel
  extends BaseViewModel<DecisionSettingsViewModelOptions>
  implements DecisionSettingsViewModelInterface
{
  readonly title = 'Decisions / System One';
  readonly subtitle =
    'Bounded scoring for closed gameplay questions. Optional — the game plays the same without it.';

  private readonly _config: DecisionSettingsConfigCapabilities;
  private readonly _decisions: DecisionBackendServiceInterface;
  private _draft = $state<DecisionDraft>(draftFor('jev-external'));
  private _lastOutcome = $state<DecisionTestOutcome | undefined>(undefined);

  constructor(options: DecisionSettingsViewModelOptions) {
    super(options);
    this._config = options.config;
    this._decisions = options.decisions;
  }

  override async initialize(): Promise<void> {
    // Load the saved configuration into the draft. Nothing is probed here: a
    // section that fires a network request on every visit is a section players
    // learn to avoid opening.
    const backend = this._decisions.resolve();
    if (backend !== undefined) {
      this._draft = {
        registryId: backend.registryId,
        endpoint: backend.endpoint,
        checkpoint: backend.checkpoint,
        credential: backend.credential ?? '',
      };
    }
    await super.initialize();
  }

  get providerOptions(): readonly DecisionProviderOption[] {
    return decisionProviderOptions(DECISION_PROVIDERS);
  }

  get draft(): DecisionDraft {
    return this._draft;
  }

  private get _registry(): ReturnType<typeof decisionProviderEntry> {
    return decisionProviderEntry(this._draft.registryId);
  }

  get credentialRequired(): boolean {
    return this._registry?.needsKey === true;
  }

  get credentialOptional(): boolean {
    return this._registry?.optionalKey === true;
  }

  get saveBlockedReason(): string | undefined {
    return decisionSaveBlocker(this._draft, this._registry);
  }

  get configured(): boolean {
    return this._decisions.summary().configured;
  }

  get summary(): DecisionBackendSummary {
    return this._decisions.summary();
  }

  get stateDescriptor(): DecisionStateDescriptor {
    return describeDecisionState(this.summary.state);
  }

  get setupSteps(): readonly { readonly id: string; readonly detail: string }[] {
    return this._lastOutcome?.steps ?? [];
  }

  get readinessMessage(): string | undefined {
    const verdict = this._decisions.lastVerdict;
    return verdict === undefined ? undefined : decisionReadinessCopy(verdict.state);
  }

  get gameplayRouting(): DecisionGameplayRouting {
    return this._decisions.gameplayRouting();
  }

  get isTesting(): boolean {
    return this._decisions.isTesting;
  }

  setProvider(registryId: string): void {
    this._draft = { ...this._draft, registryId, endpoint: this._registry?.defaultUrl ?? '' };
    this.reset();
  }

  setEndpoint(endpoint: string): void {
    this._draft = { ...this._draft, endpoint };
    this.reset();
  }

  setCheckpoint(checkpoint: string): void {
    this._draft = { ...this._draft, checkpoint };
    this.reset();
  }

  setCredential(credential: string): void {
    this._draft = { ...this._draft, credential };
    this.reset();
  }

  /** Drops a test result that no longer describes the draft on screen. */
  reset(): void {
    this._lastOutcome = undefined;
    this._decisions.invalidate();
  }

  /**
   * Persists the draft and enables the `decisions` role.
   *
   * Saving enables CONFIGURATION and nothing else. It does not mark the backend
   * ready, does not mark it qualified, and does not route a single decision.
   */
  async save(): Promise<void> {
    const blocker = this.saveBlockedReason;
    if (blocker !== undefined) {
      this.errorMessage = blocker;
      this.showSnackbar({ text: blocker, type: 'error' });
      return;
    }
    const registry = this._registry;
    const endpoint = normalizeEndpoint(this._draft.endpoint);
    const account = planProviderAccount({
      providers: this._config.getProviders(),
      registryId: this._draft.registryId,
      baseUrl: endpoint,
      apiKey: this._draft.credential,
      endpointScoped: true,
    });
    const providerId =
      account.existing?.id ??
      this._config.addProvider({
        registryId: this._draft.registryId,
        label: registry?.label ?? this._draft.registryId,
        baseUrl: endpoint,
        source: 'stored',
        ...(this._draft.credential.trim().length === 0
          ? {}
          : { credential: this._draft.credential.trim() }),
      });
    if (account.existing !== undefined && this._draft.credential.trim().length > 0) {
      this._config.updateProvider(account.existing.id, {
        credential: this._draft.credential.trim(),
      });
    }

    const existing = this._config
      .getAiConnections()
      .find(
        (connection) =>
          connection.providerId === providerId && connection.capability === 'decision',
      );
    const connectionId =
      existing?.id ??
      this._config.addAiConnection({
        providerId,
        capability: 'decision',
        label: `${registry?.label ?? this._draft.registryId} · ${this._draft.checkpoint}`,
        // `model` mirrors the checkpoint so the shared provider tree shows the
        // right identity; `params.checkpoint` is what the adapter sends.
        model: this._draft.checkpoint,
        params: {
          checkpoint: this._draft.checkpoint,
          runtime: registry?.runtime ?? 'jev',
          languages: ['en'],
          // Never set by a settings selection. Only a measurement may set it.
          qualifiedForGameplay: false,
        },
      });

    this._config.setRoleAssignment('decisions', connectionId);
    this.reset();
    await this._config.save();
    this.info('decision backend configuration saved', {
      registryId: this._draft.registryId,
      runtime: registry?.runtime,
      hasCredential: this._draft.credential.trim().length > 0,
    });
  }

  /**
   * Runs a REAL sample decision against the saved configuration.
   *
   * Deliberately tests the SAVED backend rather than the draft: "Test" is a
   * claim about what is configured, and testing unsaved edits would let a green
   * badge describe something the next reload does not have.
   */
  async test(): Promise<void> {
    if (!this.configured) {
      this.errorMessage = 'Save a backend before testing it.';
      this.showSnackbar({ text: 'Save a backend before testing it.', type: 'error' });
      return;
    }
    this._lastOutcome = (await this._decisions.test()) ?? undefined;
  }

  /** Turns the backend off and persists that. */
  async disable(): Promise<void> {
    this._config.clearRoleAssignment('decisions');
    this.reset();
    await this._config.save();
    this._draft = draftFor(this._draft.registryId);
  }
}

/** Creates the section ViewModel. */
export const createDecisionSettingsViewModel = (
  options: DecisionSettingsViewModelOptions,
): DecisionSettingsViewModelInterface => DecisionSettingsViewModel.create(options);

// apps/frontend/client/src/lib/views/agent/list/agent_list_view_model.svelte.ts
//
// ViewModel for the Agent List — shows built-in agents with toggles
// and custom agents with edit/duplicate/delete/export actions.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh fixtures instead of mocking the global service registry.
// Production wiring lives in ./agent_list_composition.ts.
//
// Contract: C-247 Custom Agent Creation

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { AgentConfig, CustomAgentDefinition } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The custom-agent registry operations the agent list performs. */
export type AgentListCapabilities = {
  listAgents(): Promise<CustomAgentDefinition[]>;
  deleteAgent(options: { id: string }): Promise<void>;
  duplicateAgent(options: { id: string }): Promise<CustomAgentDefinition>;
  exportAgent(options: { id: string }): Promise<string>;
};

// ── Types ────────────────────────────────────────────────────────────────

export type AgentListViewModelInterface = BaseViewModelInterface & {
  /** Built-in agent configurations. */
  readonly builtInAgents: ReadonlyArray<AgentConfig>;
  /** Custom agent definitions. */
  customAgents: CustomAgentDefinition[];
  /** Whether agents are loading. */
  readonly isLoading: boolean;

  /** Loads/refreshes custom agents from the registry. */
  refresh(): Promise<void>;
  /** Toggles a built-in agent's enabled state. */
  toggleBuiltIn(agentId: string): void;
  /** Opens the editor in create mode. */
  createAgent(): void;
  /** Opens the editor in edit mode. */
  editAgent(agent: CustomAgentDefinition): void;
  /** Deletes a custom agent. */
  deleteAgent(id: string): Promise<void>;
  /** Duplicates a custom agent. */
  duplicateAgent(id: string): Promise<void>;
  /** Exports a custom agent. */
  exportAgent(id: string): Promise<void>;
};

// ── Options ──────────────────────────────────────────────────────────────

export type AgentListViewModelOptions = BaseViewModelOptions & {
  /** Custom-agent registry operations. */
  agents: AgentListCapabilities;
  /** Built-in agent configurations (constant, injected). */
  builtInAgents: readonly AgentConfig[];
  onCreateAgent: () => void;
  onEditAgent: (agent: CustomAgentDefinition) => void;
};

// ── Implementation ───────────────────────────────────────────────────────

class AgentListViewModel
  extends BaseViewModel<AgentListViewModelOptions>
  implements AgentListViewModelInterface
{
  private readonly _agents: AgentListCapabilities;
  private readonly _builtInAgents: readonly AgentConfig[];

  customAgents = $state<CustomAgentDefinition[]>([]);
  isLoading = $state(false);

  constructor(options: AgentListViewModelOptions) {
    super(options);
    this._agents = options.agents;
    this._builtInAgents = options.builtInAgents;
  }

  // Built-in agents are constant — expose directly
  get builtInAgents(): ReadonlyArray<AgentConfig> {
    return this._builtInAgents;
  }

  async refresh(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = undefined;

    try {
      this.customAgents = await this._agents.listAgents();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to load agents';
    } finally {
      this.isLoading = false;
    }
  }

  /** @inheritdoc */
  toggleBuiltIn(agentId: string): void {
    // Built-in agents are read-only constants; the toggle is managed
    // by the per-chat enabledAgents array in the HUD/pipeline.
    // This UI toggle updates that set via the pipeline or HUD service.
    this.debug('toggleBuiltIn', { agentId });
  }

  /** @inheritdoc */
  createAgent(): void {
    this._options.onCreateAgent();
  }

  /** @inheritdoc */
  editAgent(agent: CustomAgentDefinition): void {
    this._options.onEditAgent(agent);
  }

  /** @inheritdoc */
  async deleteAgent(id: string): Promise<void> {
    try {
      await this._agents.deleteAgent({ id });
      await this.refresh();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to delete agent';
    }
  }

  /** @inheritdoc */
  async duplicateAgent(id: string): Promise<void> {
    try {
      await this._agents.duplicateAgent({ id });
      await this.refresh();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to duplicate agent';
    }
  }

  /** @inheritdoc */
  async exportAgent(id: string): Promise<void> {
    try {
      const json = await this._agents.exportAgent({ id });
      const agent = this.customAgents.find((entry) => entry.id === id);
      const filename = `${
        agent?.name.replace(/\s+/g, '_').toLowerCase() ?? 'agent'
      }.aikami.agent.json`;
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to export agent';
    }
  }
}

export { AgentListViewModel };

/**
 * Builds an agent list ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getAgentListViewModel` in ./agent_list_composition.ts.
 */
export const createAgentListViewModel = (
  options: AgentListViewModelOptions,
): AgentListViewModelInterface => AgentListViewModel.create(options);

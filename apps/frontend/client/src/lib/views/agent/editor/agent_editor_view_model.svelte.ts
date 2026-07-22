// apps/frontend/client/src/lib/views/agent/editor/agent_editor_view_model.svelte.ts
//
// ViewModel for the custom agent editor form. Manages field state,
// validation, save/create, duplicate, import/export, and test run.
//
// Contract: C-247 Custom Agent Creation

import {
  AGENT_MAX_DESCRIPTION_LENGTH,
  AGENT_MAX_NAME_LENGTH,
  AGENT_MAX_TIMEOUT,
  AGENT_MIN_TIMEOUT,
  BUILT_IN_AGENT_IDS,
  PHASE_OPTIONS,
  RESULT_TYPE_OPTIONS,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { AgentPhase } from '@aikami/types';
import { agentRegistryService, configService, runCustomAgent } from '$services';
import type { AgentConfig, AgentRunResult, Connection, CustomAgentDefinition } from '$types';

// ── Types ────────────────────────────────────────────────────────────────

export type AgentEditorViewModelInterface = BaseViewModelInterface & {
  // ── Form state ──────────────────────────────────────────────────
  /** Whether the editor is in edit mode (vs create mode). */
  readonly isEditing: boolean;
  /** Whether the editor panel is open. */
  readonly isOpen: boolean;
  /** Agent name value. */
  name: string;
  /** Agent description value. */
  description: string;
  /** Folder name value. */
  folder: string;
  /** Selected phase. */
  phase: AgentPhase;
  /** Prompt template text. */
  promptTemplate: string;
  /** JSON Schema as string for the code editor. */
  outputSchemaText: string;
  /** Schema validation error (empty = valid). */
  schemaError: string;
  /** Selected result type. */
  resultType: string;
  /** Selected connection ID override (empty = use default). */
  connectionId: string;
  /** Timeout in milliseconds. */
  timeout: number;
  /** Validation error for the form. */
  formError: string;
  /** Whether save is in progress. */
  readonly isSaving: boolean;

  // ── Computed ────────────────────────────────────────────────────
  /** Phase dropdown options. */
  readonly phaseOptions: { value: string; label: string }[];
  /** Result type options. */
  readonly resultTypeOptions: { value: string; label: string }[];
  /** Connection options for the dropdown. */
  readonly connectionOptions: { value: string; label: string }[];
  /** Whether the schema text is valid JSON. */
  readonly isSchemaValid: boolean;
  /** Formatted timeout display. */
  readonly timeoutFormatted: string;
  /** Whether the editor is in create mode. */
  readonly isCreateMode: boolean;

  // ── Test run state ──────────────────────────────────────────────
  /** Test input text. */
  testInput: string;
  /** Whether a test run is in progress. */
  readonly isTestRunning: boolean;
  /** Test run result (undefined if no test run yet). */
  testResult: AgentRunResult | undefined;
  /** Resolved prompt from the last test run. */
  testResolvedPrompt: string;
  /** Raw LLM response from the last test run. */
  testRawResponse: string;
  /** Execution time from the last test run. */
  testDurationMs: number;

  // ── Actions ─────────────────────────────────────────────────────
  /** Opens the editor in create mode. */
  openCreate(): void;
  /** Opens the editor in edit mode for an existing agent. */
  openEdit(agent: CustomAgentDefinition): void;
  /** Closes the editor. */
  close(): void;
  /** Saves the agent (creates or updates). */
  save(): Promise<void>;
  /** Runs a test execution with mock input. */
  testRun(): Promise<void>;
  /** Cancels an in-flight test run. */
  cancelTestRun(): void;
  /** Imports an agent from a file. */
  importAgent(file: File): Promise<void>;
  /** Exports the current agent to a file download. */
  exportAgent(): Promise<void>;
};

// ── Options ──────────────────────────────────────────────────────────────

export type AgentEditorViewModelOptions = BaseViewModelOptions;

// ── Implementation ───────────────────────────────────────────────────────

class AgentEditorViewModel
  extends BaseViewModel<AgentEditorViewModelOptions>
  implements AgentEditorViewModelInterface
{
  // ── Form state ──────────────────────────────────────────────────

  isOpen = $state(false);
  private _editingId: string | undefined = $state(undefined);
  name = $state('');
  description = $state('');
  folder = $state('');
  phase = $state<AgentPhase>('post');
  promptTemplate = $state('');
  outputSchemaText = $state('{}');
  schemaError = $state('');
  resultType = $state('custom');
  connectionId = $state('');
  timeout = $state(15_000);
  formError = $state('');
  isSaving = $state(false);
  // ── Test run state ─────────────────────────────────────────────
  testInput = $state('');
  isTestRunning = $state(false);
  testResult = $state<AgentRunResult | undefined>(undefined);
  testResolvedPrompt = $state('');
  testRawResponse = $state('');
  testDurationMs = $state(0);
  private _abortController: AbortController | undefined;

  // ── Getters ────────────────────────────────────────────────────

  get isEditing(): boolean {
    return this._editingId !== undefined;
  }

  get isCreateMode(): boolean {
    return !this.isEditing;
  }

  get phaseOptions(): { value: string; label: string }[] {
    return PHASE_OPTIONS.map((p) => ({ value: p.id, label: p.label }));
  }

  get resultTypeOptions(): { value: string; label: string }[] {
    return RESULT_TYPE_OPTIONS.map((r) => ({ value: r.id, label: r.label }));
  }

  get connectionOptions(): { value: string; label: string }[] {
    const options = [{ value: '', label: 'Use chat default' }];
    for (const conn of configService.state.connections as readonly Connection[]) {
      options.push({ value: conn.id, label: conn.name });
    }
    return options;
  }

  get isSchemaValid(): boolean {
    return this.schemaError.length === 0;
  }

  get timeoutFormatted(): string {
    return `${(this.timeout / 1000).toFixed(1)}s`;
  }

  // ── Actions ────────────────────────────────────────────────────

  /** @inheritdoc */
  openCreate(): void {
    this._resetForm();
    this.isOpen = true;
  }

  /** @inheritdoc */
  openEdit(agent: CustomAgentDefinition): void {
    if (agent.isBuiltIn) {
      this.formError = 'Cannot edit built-in agents';
      return;
    }
    this._editingId = agent.id;
    this.name = agent.name;
    this.description = agent.description;
    this.folder = agent.folder ?? '';
    this.phase = agent.phase;
    this.promptTemplate = agent.promptTemplate;
    this.outputSchemaText = JSON.stringify(agent.outputSchema, null, 2);
    this.schemaError = '';
    this.resultType = agent.resultType;
    this.connectionId = agent.connectionId ?? '';
    this.timeout = agent.timeout;
    this.formError = '';
    this.isOpen = true;
  }

  /** @inheritdoc */
  close(): void {
    this._editingId = undefined;
    this.isOpen = false;
    this._resetForm();
  }

  /** @inheritdoc */
  async save(): Promise<void> {
    this.formError = '';

    // Validate name
    const trimmedName = this.name.trim();
    if (trimmedName.length === 0) {
      this.formError = 'Name is required';
      return;
    }
    if (trimmedName.length > AGENT_MAX_NAME_LENGTH) {
      this.formError = `Name must be ${AGENT_MAX_NAME_LENGTH} characters or fewer`;
      return;
    }

    // Validate built-in ID collision
    if (BUILT_IN_AGENT_IDS.has(trimmedName.toLowerCase().replace(/\s+/g, '-'))) {
      this.formError = 'Agent name conflicts with a built-in agent ID';
      return;
    }

    // Validate description
    if (this.description.length > AGENT_MAX_DESCRIPTION_LENGTH) {
      this.formError = `Description must be ${AGENT_MAX_DESCRIPTION_LENGTH} characters or fewer`;
      return;
    }

    // Validate timeout
    if (this.timeout < AGENT_MIN_TIMEOUT || this.timeout > AGENT_MAX_TIMEOUT) {
      this.formError = `Timeout must be between ${AGENT_MIN_TIMEOUT}ms and ${AGENT_MAX_TIMEOUT}ms`;
      return;
    }

    // Validate output schema JSON
    let outputSchema: Record<string, unknown> = {};
    try {
      outputSchema = JSON.parse(this.outputSchemaText);
    } catch {
      // Schema parse error is shown inline, don't block save
    }

    this.isSaving = true;

    try {
      if (this._editingId) {
        await agentRegistryService.updateAgent({
          id: this._editingId,
          updates: {
            name: trimmedName,
            description: this.description,
            folder: this.folder.trim() || undefined,
            phase: this.phase,
            promptTemplate: this.promptTemplate,
            outputSchema,
            resultType: this.resultType,
            connectionId: this.connectionId || undefined,
            timeout: this.timeout,
          },
        });
      } else {
        await agentRegistryService.createAgent({
          name: trimmedName,
          description: this.description,
          folder: this.folder.trim() || undefined,
          phase: this.phase,
          promptTemplate: this.promptTemplate,
          outputSchema,
          resultType: this.resultType,
          connectionId: this.connectionId || undefined,
          timeout: this.timeout,
          contextKey: trimmedName.toUpperCase().replace(/\s+/g, '_'),
        });
      }
      this.close();
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Failed to save agent';
    } finally {
      this.isSaving = false;
    }
  }

  /** @inheritdoc */
  async testRun(): Promise<void> {
    if (this.isTestRunning) {
      return;
    }

    this.testResult = undefined;
    this.testResolvedPrompt = '';
    this.testRawResponse = '';
    this.testDurationMs = 0;
    this.isTestRunning = true;

    this._abortController = new AbortController();

    // Parse output schema
    let outputSchema: Record<string, unknown> = {};
    try {
      outputSchema = JSON.parse(this.outputSchemaText);
    } catch {
      this.isTestRunning = false;
      this.formError = 'Cannot test run with invalid output schema';
      return;
    }

    const tempId = `test-${crypto.randomUUID()}`;
    const mockContext = {
      chatId: 'test-chat',
      userMessage: this.testInput || 'Test input for agent verification',
      systemPrompt: '',
      preResults: [],
    };

    const config: AgentConfig = {
      id: tempId,
      name: this.name || 'Test Agent',
      phase: this.phase,
      systemPrompt: this.promptTemplate,
      timeout: this.timeout,
      enabled: true,
      contextKey: undefined,
    };

    const mockDefinition: CustomAgentDefinition = {
      formatVersion: '1.0.0',
      type: 'agent_definition',
      id: tempId,
      name: this.name || 'Test Agent',
      description: this.description,
      phase: this.phase,
      promptTemplate: this.promptTemplate,
      outputSchema,
      resultType: this.resultType,
      connectionId: this.connectionId || undefined,
      timeout: this.timeout,
      enabled: true,
      isBuiltIn: false,
      uid: 'test-user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const start = performance.now();

    try {
      const result = await runCustomAgent({
        config,
        context: mockContext,
        definition: mockDefinition,
        mockInput: this.testInput || undefined,
      });

      this.testResult = result;
      this.testDurationMs = Math.round(performance.now() - start);

      if (result.output && typeof result.output === 'object') {
        this.testRawResponse = JSON.stringify(result.output, null, 2);
      } else {
        this.testRawResponse = String(result.output ?? '');
      }
    } catch (error) {
      this.testResult = {
        agentId: tempId,
        phase: this.phase,
        success: false,
        error: error instanceof Error ? error.message : 'Test run failed',
        durationMs: Math.round(performance.now() - start),
      };
    } finally {
      this.isTestRunning = false;
      this._abortController = undefined;
    }
  }

  /** @inheritdoc */
  cancelTestRun(): void {
    this._abortController?.abort();
    this.isTestRunning = false;
    this._abortController = undefined;
  }

  /** @inheritdoc */
  async importAgent(file: File): Promise<void> {
    try {
      const text = await file.text();
      const definition = await agentRegistryService.importAgent({ json: text });
      this.debug('importAgent:done', { id: definition.id, name: definition.name });
      this.openEdit(definition);
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Failed to import agent';
    }
  }

  /** @inheritdoc */
  async exportAgent(): Promise<void> {
    if (!this._editingId) {
      return;
    }

    try {
      const json = await agentRegistryService.exportAgent({ id: this._editingId });
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.name.replace(/\s+/g, '_').toLowerCase()}.aikami.agent.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Failed to export agent';
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  /**
   * Resets all form fields to defaults.
   */
  private _resetForm(): void {
    this._editingId = undefined;
    this.name = '';
    this.description = '';
    this.folder = '';
    this.phase = 'post';
    this.promptTemplate = '';
    this.outputSchemaText =
      '{\n  "type": "object",\n  "properties": {},\n  "additionalProperties": false\n}';
    this.schemaError = '';
    this.resultType = 'custom';
    this.connectionId = '';
    this.timeout = 15_000;
    this.formError = '';
    this.testInput = '';
    this.testResult = undefined;
    this.testResolvedPrompt = '';
    this.testRawResponse = '';
    this.testDurationMs = 0;
  }
}

export { AgentEditorViewModel };

export const getAgentEditorViewModel = (
  options: AgentEditorViewModelOptions,
): AgentEditorViewModelInterface => AgentEditorViewModel.create(options);

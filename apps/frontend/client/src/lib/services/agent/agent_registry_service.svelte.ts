// apps/frontend/client/src/lib/services/agent/agent_registry_service.svelte.ts
//
// Agent Registry Service — Firestore-backed CRUD for custom agent
// definitions, plus import/export and duplication.
//
// Contract: C-247 Custom Agent Creation

import {
  AGENT_DEFINITIONS_COLLECTION,
  AGENT_MAX_DESCRIPTION_LENGTH,
  AGENT_MAX_NAME_LENGTH,
  AGENT_MAX_TIMEOUT,
  AGENT_MIN_TIMEOUT,
  BUILT_IN_AGENT_IDS,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { CreateAgentInput, CustomAgentDefinition, UpdateAgentInput } from '$types';
import { authService } from '../auth/auth_service.svelte.ts';

type FirestoreModule = typeof import('@aikami/frontend/configs/firestore.ts');

// ── Types ────────────────────────────────────────────────────────────────

export type AgentRegistryServiceOptions = BaseFrontendClassOptions;

export type AgentRegistryServiceInterface = BaseFrontendClassInterface & {
  /** Create a new custom agent definition. */
  createAgent(options: CreateAgentInput): Promise<CustomAgentDefinition>;

  /** Update an existing custom agent. */
  updateAgent(options: { id: string; updates: UpdateAgentInput }): Promise<CustomAgentDefinition>;

  /** Delete a custom agent. Cannot delete built-in agents. */
  deleteAgent(options: { id: string }): Promise<void>;

  /** Get a single custom agent definition. */
  getAgent(options: { id: string }): Promise<CustomAgentDefinition | undefined>;

  /** List all custom agents for the current user, optionally filtered by folder. */
  listAgents(options?: { folder?: string }): Promise<CustomAgentDefinition[]>;

  /** Duplicate an agent (copy with " (Copy)" suffix). */
  duplicateAgent(options: { id: string }): Promise<CustomAgentDefinition>;

  /** Import an agent from a .aikami.agent.json string. */
  importAgent(options: { json: string }): Promise<CustomAgentDefinition>;

  /** Export an agent as a .aikami.agent.json string. */
  exportAgent(options: { id: string }): Promise<string>;
};

// ── Default values ───────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 15_000;

/**
 * Strips keys with undefined values from an object, returning a plain
 * object suitable for Firestore setDoc (which rejects undefined).
 */
const stripUndefined = <T extends Record<string, unknown>>(obj: T): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

// ── Implementation ───────────────────────────────────────────────────────

class AgentRegistryService
  extends BaseFrontendClass<AgentRegistryServiceOptions>
  implements AgentRegistryServiceInterface
{
  /** Lazily-loaded Firestore module. */
  private _firestoreModule: FirestoreModule | undefined;

  private async _getFirestore(): Promise<FirestoreModule> {
    if (this._firestoreModule) {
      return this._firestoreModule;
    }
    this._firestoreModule = await import('@aikami/frontend/configs/firestore.ts');
    return this._firestoreModule;
  }

  /**
   * Validates a candidate agent id — rejects built-in IDs.
   */
  private _validateNotBuiltIn(id: string): void {
    if (BUILT_IN_AGENT_IDS.has(id)) {
      throw new Error('Cannot modify built-in agent');
    }
  }

  /**
   * Validates agent input fields.
   */
  private _validateInput(input: CreateAgentInput | UpdateAgentInput): void {
    if ('name' in input && input.name !== undefined) {
      const name = input.name.trim();
      if (name.length === 0) {
        throw new Error('Name is required');
      }
      if (name.length > AGENT_MAX_NAME_LENGTH) {
        throw new Error(`Name must be ${AGENT_MAX_NAME_LENGTH} characters or fewer`);
      }
    }
    if ('description' in input && input.description !== undefined) {
      if (input.description.length > AGENT_MAX_DESCRIPTION_LENGTH) {
        throw new Error(`Description must be ${AGENT_MAX_DESCRIPTION_LENGTH} characters or fewer`);
      }
    }
    if ('timeout' in input && input.timeout !== undefined) {
      if (input.timeout < AGENT_MIN_TIMEOUT || input.timeout > AGENT_MAX_TIMEOUT) {
        throw new Error(
          `Timeout must be between ${AGENT_MIN_TIMEOUT}ms and ${AGENT_MAX_TIMEOUT}ms`,
        );
      }
    }
  }

  /** @inheritdoc */
  async createAgent(options: CreateAgentInput): Promise<CustomAgentDefinition> {
    this._validateInput(options);

    const uid = authService.uid;
    if (!uid) {
      throw new Error('User must be authenticated to create an agent');
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const definition: CustomAgentDefinition = {
      formatVersion: '1.0.0',
      type: 'agent_definition',
      id,
      name: options.name.trim(),
      description: options.description ?? '',
      folder: options.folder?.trim() || undefined,
      phase: options.phase,
      promptTemplate: options.promptTemplate,
      outputSchema: options.outputSchema,
      resultType: options.resultType,
      connectionId: options.connectionId || undefined,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      enabled: true,
      isBuiltIn: false,
      contextKey: options.contextKey || undefined,
      uid,
      createdAt: now,
      updatedAt: now,
    };

    const fs = await this._getFirestore();
    const docRef = fs.doc(fs.firestore, AGENT_DEFINITIONS_COLLECTION, id);
    await fs.setDoc(docRef, stripUndefined(definition));

    this.debug('createAgent:done', { id, name: definition.name });
    return definition;
  }

  /** @inheritdoc */
  async updateAgent({
    id,
    updates,
  }: {
    id: string;
    updates: UpdateAgentInput;
  }): Promise<CustomAgentDefinition> {
    this._validateNotBuiltIn(id);
    this._validateInput(updates);

    const existing = await this.getAgent({ id });
    if (!existing) {
      throw new Error(`Agent "${id}" not found`);
    }

    const now = new Date().toISOString();
    const updated: CustomAgentDefinition = {
      ...existing,
      name: updates.name !== undefined ? updates.name.trim() : existing.name,
      description: updates.description ?? existing.description,
      folder: updates.folder !== undefined ? updates.folder.trim() || undefined : existing.folder,
      phase: updates.phase ?? existing.phase,
      promptTemplate: updates.promptTemplate ?? existing.promptTemplate,
      outputSchema: updates.outputSchema ?? existing.outputSchema,
      resultType: updates.resultType ?? existing.resultType,
      connectionId:
        updates.connectionId !== undefined
          ? updates.connectionId || undefined
          : existing.connectionId,
      timeout: updates.timeout ?? existing.timeout,
      enabled: updates.enabled ?? existing.enabled,
      contextKey:
        updates.contextKey !== undefined ? updates.contextKey || undefined : existing.contextKey,
      updatedAt: now,
    };

    const fs = await this._getFirestore();
    const docRef = fs.doc(fs.firestore, AGENT_DEFINITIONS_COLLECTION, id);
    await fs.setDoc(docRef, stripUndefined(updated));

    this.debug('updateAgent:done', { id });
    return updated;
  }

  /** @inheritdoc */
  async deleteAgent({ id }: { id: string }): Promise<void> {
    this._validateNotBuiltIn(id);

    const fs = await this._getFirestore();
    const docRef = fs.doc(fs.firestore, AGENT_DEFINITIONS_COLLECTION, id);
    await fs.deleteDoc(docRef);

    this.debug('deleteAgent:done', { id });
  }

  /** @inheritdoc */
  async getAgent({ id }: { id: string }): Promise<CustomAgentDefinition | undefined> {
    const fs = await this._getFirestore();
    const docRef = fs.doc(fs.firestore, AGENT_DEFINITIONS_COLLECTION, id);
    const snapshot = await fs.getDoc(docRef);

    if (!snapshot.exists()) {
      return undefined;
    }

    return snapshot.data() as CustomAgentDefinition;
  }

  /** @inheritdoc */
  async listAgents(options?: { folder?: string }): Promise<CustomAgentDefinition[]> {
    const uid = authService.uid;
    if (!uid) {
      return [];
    }

    const fs = await this._getFirestore();
    const agentsCollection = fs.collection(fs.firestore, AGENT_DEFINITIONS_COLLECTION);

    const constraints: Array<ReturnType<typeof fs.where>> = [fs.where('uid', '==', uid)];

    if (options?.folder) {
      constraints.push(fs.where('folder', '==', options.folder));
    }

    // orderBy is applied separately from where constraints
    const q = fs.query(agentsCollection, ...constraints, fs.orderBy('createdAt', 'asc'));
    const snapshot = await fs.getDocs(q);

    const agents: CustomAgentDefinition[] = [];
    for (const doc of snapshot.docs) {
      agents.push(doc.data() as CustomAgentDefinition);
    }

    return agents;
  }

  /** @inheritdoc */
  async duplicateAgent({ id }: { id: string }): Promise<CustomAgentDefinition> {
    const existing = await this.getAgent({ id });
    if (!existing) {
      throw new Error(`Agent "${id}" not found`);
    }

    const copyName = `${existing.name} (Copy)`;
    return this.createAgent({
      name: copyName,
      description: existing.description,
      folder: existing.folder,
      phase: existing.phase,
      promptTemplate: existing.promptTemplate,
      outputSchema: existing.outputSchema,
      resultType: existing.resultType,
      connectionId: existing.connectionId,
      timeout: existing.timeout,
      contextKey: existing.contextKey,
    });
  }

  /** @inheritdoc */
  async importAgent({ json }: { json: string }): Promise<CustomAgentDefinition> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Invalid agent file: not valid JSON');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid agent file: not a valid agent definition object');
    }

    const candidate = parsed as Record<string, unknown>;

    if (candidate.type !== 'agent_definition') {
      throw new Error('Invalid agent file: missing type "agent_definition"');
    }

    if (typeof candidate.formatVersion !== 'string') {
      throw new Error('Invalid agent file: missing formatVersion');
    }

    // Future version check
    const [major] = candidate.formatVersion.split('.');
    if (Number(major) > 1) {
      throw new Error(`This agent definition requires Aikami v${candidate.formatVersion} or later`);
    }

    if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
      throw new Error('Invalid agent file: name is required');
    }

    // Check for duplicate name and append suffix
    const existingAgents = await this.listAgents();
    let finalName = (candidate.name as string).trim();
    const sameFolder = (candidate.folder as string | undefined)?.trim() || undefined;
    const nameExists = existingAgents.some(
      (a) => a.name === finalName && (a.folder ?? undefined) === sameFolder,
    );
    if (nameExists) {
      finalName = `${finalName} (2)`;
    }

    const uid = authService.uid;
    if (!uid) {
      throw new Error('User must be authenticated to import an agent');
    }

    return this.createAgent({
      name: finalName,
      description: typeof candidate.description === 'string' ? candidate.description : '',
      folder: sameFolder,
      phase: (candidate.phase as 'pre' | 'post') ?? 'post',
      promptTemplate: typeof candidate.promptTemplate === 'string' ? candidate.promptTemplate : '',
      outputSchema:
        typeof candidate.outputSchema === 'object' && candidate.outputSchema !== null
          ? (candidate.outputSchema as Record<string, unknown>)
          : {},
      resultType: typeof candidate.resultType === 'string' ? candidate.resultType : 'custom',
      connectionId: typeof candidate.connectionId === 'string' ? candidate.connectionId : undefined,
      timeout: typeof candidate.timeout === 'number' ? candidate.timeout : DEFAULT_TIMEOUT,
      contextKey: typeof candidate.contextKey === 'string' ? candidate.contextKey : undefined,
    });
  }

  /** @inheritdoc */
  async exportAgent({ id }: { id: string }): Promise<string> {
    const existing = await this.getAgent({ id });
    if (!existing) {
      throw new Error(`Agent "${id}" not found`);
    }

    // Strip internal fields for export
    const exportable = {
      formatVersion: existing.formatVersion,
      type: existing.type,
      id: existing.id,
      name: existing.name,
      description: existing.description,
      folder: existing.folder,
      phase: existing.phase,
      promptTemplate: existing.promptTemplate,
      outputSchema: existing.outputSchema,
      resultType: existing.resultType,
      connectionId: existing.connectionId,
      timeout: existing.timeout,
      contextKey: existing.contextKey,
    };

    return JSON.stringify(exportable, null, 2);
  }
}

export { AgentRegistryService };

/**
 * Shared singleton instance of the agent registry service.
 */
export const agentRegistryService: AgentRegistryServiceInterface = AgentRegistryService.create({
  className: 'AgentRegistryService',
}) as AgentRegistryServiceInterface;

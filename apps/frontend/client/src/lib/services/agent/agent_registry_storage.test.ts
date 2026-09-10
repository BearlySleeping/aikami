// apps/frontend/client/src/lib/services/agent/agent_registry_storage.test.ts
//
// Contract tests for the local custom-agent repository (C-386b AC-6) against
// a real in-memory libSQL database with the production migrations applied.
// Verifies every AgentRegistryServiceInterface operation completes against the
// local `custom_agents` table only, with SQLite enforcing the schema.

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { countTableRows, createRealLocalDatabase } from '../__tests__/local_database_fixture.ts';

const fixture = await createRealLocalDatabase();

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => fixture.db),
}));

// ── Service under test ────────────────────────────────────────────────

import type { CustomAgentDefinition } from '$types';
import type { AgentRegistryStorageInterface } from './agent_registry_storage.svelte.ts';
import { agentRegistryStorage } from './agent_registry_storage.svelte.ts';

const makeAgent = (id: string, name: string, folder?: string): CustomAgentDefinition =>
  ({
    formatVersion: '1.0.0',
    type: 'agent_definition',
    id,
    name,
    folder,
    phase: 'post',
    promptTemplate: 'template',
    outputSchema: {},
    resultType: 'custom',
    timeout: 15_000,
    enabled: true,
    isBuiltIn: false,
    uid: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as CustomAgentDefinition;

describe('AgentRegistryStorage (local SQLite)', () => {
  let storage: AgentRegistryStorageInterface;

  beforeEach(async () => {
    await fixture.reset();
    storage = agentRegistryStorage;
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('createAgent then getAgent returns it', async () => {
    await storage.createAgent(makeAgent('a1', 'Scholar'));
    const agent = await storage.getAgent({ id: 'a1' });
    expect(agent?.name).toBe('Scholar');
    expect(await countTableRows(fixture.db, 'custom_agents')).toBe(1);
  });

  test('getAgent returns undefined for missing agent', async () => {
    expect(await storage.getAgent({ id: 'missing' })).toBeUndefined();
  });

  test('updateAgent merges fields', async () => {
    await storage.createAgent(makeAgent('a1', 'Scholar'));
    await storage.updateAgent({ ...makeAgent('a1', 'Scholar Master'), description: 'desc' });
    const agent = await storage.getAgent({ id: 'a1' });
    expect(agent?.name).toBe('Scholar Master');
    expect(agent?.description).toBe('desc');
  });

  test('deleteAgent removes the row', async () => {
    await storage.createAgent(makeAgent('a1', 'Scholar'));
    await storage.deleteAgent({ id: 'a1' });
    expect(await storage.getAgent({ id: 'a1' })).toBeUndefined();
    expect(await countTableRows(fixture.db, 'custom_agents')).toBe(0);
  });

  test('listAgents returns all agents', async () => {
    await storage.createAgent(makeAgent('a1', 'One'));
    await storage.createAgent(makeAgent('a2', 'Two'));
    const agents = await storage.listAgents();
    expect(agents).toHaveLength(2);
  });

  test('listAgents filters by folder', async () => {
    await storage.createAgent(makeAgent('a1', 'One', 'combat'));
    await storage.createAgent(makeAgent('a2', 'Two', 'rp'));
    await storage.createAgent(makeAgent('a3', 'Three'));

    const combat = await storage.listAgents({ folder: 'combat' });
    expect(combat).toHaveLength(1);
    expect(combat[0]?.id).toBe('a1');

    const none = await storage.listAgents({ folder: 'nonexistent' });
    expect(none).toHaveLength(0);
  });
});

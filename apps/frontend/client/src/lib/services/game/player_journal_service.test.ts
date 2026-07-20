// apps/frontend/client/src/lib/services/game/player_journal_service.test.ts
//
// Unit tests for PlayerJournalService — CRUD for player-written journal entries.
//
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { beforeEach, describe, expect, test } from 'bun:test';

describe('PlayerJournalService', () => {
  let service: import('./player_journal_service.svelte').PlayerJournalServiceInterface;

  beforeEach(async () => {
    const mod = await import('./player_journal_service.svelte');
    service = mod.playerJournalService;
    service.reset();
  });

  test('should export a singleton instance', () => {
    expect(service).toBeDefined();
    expect(typeof service.createEntry).toBe('function');
    expect(typeof service.loadEntries).toBe('function');
    expect(typeof service.updateEntry).toBe('function');
    expect(typeof service.deleteEntry).toBe('function');
  });

  test('should start with empty entries', () => {
    expect(service.entries).toEqual([]);
  });

  test('should create a journal entry with title and content', async () => {
    const entry = await service.createEntry({
      campaignId: 'test-campaign',
      sessionNumber: 1,
      title: 'My First Entry',
      content: 'Today we ventured into the dark forest.',
    });

    expect(entry.title).toBe('My First Entry');
    expect(entry.content).toBe('Today we ventured into the dark forest.');
    expect(entry.sessionNumber).toBe(1);
    expect(entry.id).toBeDefined();
    expect(entry.createdAt).toBeDefined();
    expect(entry.updatedAt).toEqual(entry.createdAt);
  });

  test('should create entry with tags', async () => {
    const entry = await service.createEntry({
      campaignId: 'test-campaign',
      sessionNumber: 1,
      title: 'Quest Notes',
      content: 'We need to find the ancient relic.',
      tags: ['quest', 'relic'],
    });

    expect(entry.tags).toEqual(['quest', 'relic']);
  });

  test('should reject empty title', async () => {
    await expect(
      service.createEntry({
        campaignId: 'test-campaign',
        sessionNumber: 1,
        title: '',
        content: 'Some content.',
      }),
    ).rejects.toThrow('Title must be');
  });

  test('should reject whitespace-only content', async () => {
    await expect(
      service.createEntry({
        campaignId: 'test-campaign',
        sessionNumber: 1,
        title: 'Title',
        content: '   ',
      }),
    ).rejects.toThrow('Content must be');
  });

  test('should load entries for a campaign', async () => {
    const campaignId = `test-campaign-${crypto.randomUUID()}`;

    await service.createEntry({
      campaignId,
      sessionNumber: 1,
      title: 'Entry 1',
      content: 'First entry.',
    });
    await service.createEntry({
      campaignId,
      sessionNumber: 1,
      title: 'Entry 2',
      content: 'Second entry.',
    });

    await service.loadEntries({ campaignId });
    expect(service.entries.length).toBe(2);
  });

  test('should update an existing entry', async () => {
    const entry = await service.createEntry({
      campaignId: 'test-campaign',
      sessionNumber: 1,
      title: 'Original Title',
      content: 'Original content.',
    });

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5));

    await service.updateEntry({
      id: entry.id,
      title: 'Updated Title',
      content: 'Updated content.',
    });

    await service.loadEntries({ campaignId: 'test-campaign' });
    const updated = service.entries.find((e) => e.id === entry.id);
    expect(updated?.title).toBe('Updated Title');
    expect(updated?.content).toBe('Updated content.');
    expect(updated?.updatedAt).toBeDefined();
  });

  test('should delete an entry', async () => {
    const entry = await service.createEntry({
      campaignId: 'test-campaign',
      sessionNumber: 1,
      title: 'To Delete',
      content: 'This entry will be deleted.',
    });

    await service.deleteEntry({ id: entry.id });

    await service.loadEntries({ campaignId: 'test-campaign' });
    expect(service.entries.find((e) => e.id === entry.id)).toBeUndefined();
  });

  test('should survive reset and reload', async () => {
    const campaignId = `test-persist-${crypto.randomUUID()}`;

    await service.createEntry({
      campaignId,
      sessionNumber: 1,
      title: 'Persistent Entry',
      content: 'This should survive reset.',
    });

    service.reset();
    expect(service.entries).toEqual([]);

    await service.loadEntries({ campaignId });
    expect(service.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('should serialize and hydrate', async () => {
    // Create some entries to test round-trip
    const campaignId = `test-serialize-${crypto.randomUUID()}`;
    await service.createEntry({
      campaignId,
      sessionNumber: 1,
      title: 'Test Entry 1',
      content: 'First test entry.',
      tags: ['test', 'serialize'],
    });
    await service.createEntry({
      campaignId,
      sessionNumber: 2,
      title: 'Test Entry 2',
      content: 'Second test entry.',
    });

    const journalService = service as unknown as {
      serialize(): { entries: unknown[] };
      hydrate(data: { entries: unknown[] }): void;
    };

    // Serialize
    const snapshot = journalService.serialize();
    expect(snapshot).toHaveProperty('entries');
    expect(Array.isArray(snapshot.entries)).toBe(true);
    expect(snapshot.entries.length).toBe(2);

    // Store original entries
    const originalEntries = [...service.entries];

    // Clear and hydrate
    service.reset();
    expect(service.entries.length).toBe(0);

    journalService.hydrate(snapshot);

    // Verify restored entries match original
    expect(service.entries.length).toBe(originalEntries.length);
    expect(service.entries[0].title).toBe(originalEntries[0].title);
    expect(service.entries[1].title).toBe(originalEntries[1].title);
  });
});

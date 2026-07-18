// biome-ignore-all lint/style/useNamingConvention: test fixture uses content pack snake_case keys
// apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts
//
// Unit tests for NpcDialogueService — the NPC dialogue orchestrator.
// Covers: authored fallback (AC-1), malformed output rejection (AC-2),
// precondition whitelist + dispatch (AC-3), context projection (AC-4),
// cancellation + regenerate safety (AC-5).
//
// Contract: C-328 Integrate Bounded AI NPC Dialogue with Authored Fallbacks

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NpcDialogueService, npcDialogueService } from './npc_dialogue_service.svelte';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUB_EMBERWATCH = {
  npcs: {
    village_elder: { name: 'Elder Thalia', defaultDialogueKey: 'elder_thalia_greeting' },
    traveling_merchant: {
      name: 'Keth the Merchant',
      defaultDialogueKey: 'merchant_keth_greeting',
      isVendor: true,
      vendorInventory: 'ironSword, healthPotion',
    },
    shade_guardian: {
      name: 'Shade Guardian',
      defaultDialogueKey: 'shade_guardian_manifest',
      combatStats: { hitPoints: 30 },
    },
  },
  dialogues: {
    elder_thalia_greeting: '"Greetings, traveler. Our village has need of your aid."',
    merchant_keth_greeting: '"Welcome! Finest wares this side of the kingdom!"',
    shade_guardian_manifest: '"You shall not pass."',
  },
  quests: [{ id: 'fading_ward', name: 'The Fading Ward', offerDialogueKey: 'elder_thalia_offer' }],
  encounters: [{ id: 'ruined_ward_encounter', encounterNpcIds: ['shade_guardian'] }],
};

let execLog: string[] = [];

const makeContentProvider = (overrides?: Partial<typeof STUB_EMBERWATCH>) => {
  const data = { ...STUB_EMBERWATCH, ...overrides };
  return {
    getNpc: mock((npcId: string) => {
      const npc = (data.npcs as Record<string, Record<string, unknown>>)[npcId];
      return npc ? { ...npc } : undefined;
    }),
    getDialogue: mock((key: string) => {
      const d = (data.dialogues as Record<string, string>)[key];
      return d;
    }),
    getQuest: mock((questId: string) => {
      return data.quests.find((q) => q.id === questId);
    }),
    getAllQuests: mock(() => data.quests),
    getAllEncounters: mock(() => data.encounters),
    getEncounter: mock((encounterId: string) => {
      return data.encounters.find((e) => e.id === encounterId);
    }),
  };
};

const makeExecutors = () => {
  execLog = [];
  return {
    trade: mock((_opts: { npcId: string }) => {
      execLog.push('trade');
      return true;
    }),
    offerQuest: mock((_opts: { npcId: string; questId: string }) => {
      execLog.push('offerQuest');
      return true;
    }),
    skillCheck: mock((_opts: { skill: string; difficultyClass: number }) => {
      execLog.push('skillCheck');
      return true;
    }),
    giveItem: mock((_opts: { itemId: string; quantity: number }) => {
      execLog.push('giveItem');
      return true;
    }),
    startCombat: mock((_opts: { npcId: string; npcName: string; encounterId?: string }) => {
      execLog.push('startCombat');
      return true;
    }),
  };
};

const makeTextGenerator = (options?: { text?: string; structured?: unknown; error?: Error }) => {
  return mock(async (_opts: Record<string, unknown>) => {
    if (options?.error) {
      throw options.error;
    }
    return {
      text: options?.text ?? 'Hello.',
      structured: options?.structured,
    };
  });
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  const contentProvider = makeContentProvider();
  const textGenerator = makeTextGenerator();
  npcDialogueService.configure({
    contentProvider,
    textGenerator,
    executors: makeExecutors(),
  });
});

afterEach(() => {
  // Reconfigure with fresh state to prevent test bleed
  const contentProvider = makeContentProvider();
  const textGenerator = makeTextGenerator();
  npcDialogueService.configure({
    contentProvider,
    textGenerator,
    executors: makeExecutors(),
  });
});

// ---------------------------------------------------------------------------
// AC-1: Authored fallback when AI fails
// ---------------------------------------------------------------------------

describe('AC-1: Authored fallback', () => {
  test('returns authored turn when text generator throws', async () => {
    const contentProvider = makeContentProvider();
    const textGenerator = makeTextGenerator({ error: new Error('connection refused') });
    npcDialogueService.configure({
      contentProvider,
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: 'Hello' }],
      signal: controller.signal,
    });

    expect(turn.source).toBe('authored');
    expect(turn.narrative.length).toBeGreaterThan(0);
    expect(turn.choices.length).toBeGreaterThanOrEqual(1);
    expect(turn.choices.length).toBeLessThanOrEqual(4);
    // No error text or *...* placeholder
    expect(turn.narrative).not.toContain('*...*');
  });

  test('returns generic fallback for NPC without defaultDialogueKey', async () => {
    const contentProvider = makeContentProvider({
      npcs: { bob: { name: 'Bob' } },
    });
    const textGenerator = makeTextGenerator({ error: new Error('no capability') });
    npcDialogueService.configure({
      contentProvider,
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'bob',
      npcName: 'Bob',
      messages: [],
      signal: controller.signal,
    });

    expect(turn.source).toBe('authored');
    expect(turn.narrative.length).toBeGreaterThan(0);
    expect(turn.narrative).toContain('Bob');
  });
});

// ---------------------------------------------------------------------------
// AC-2: Malformed model output rejected
// ---------------------------------------------------------------------------

describe('AC-2: Malformed output rejection', () => {
  test('narrative-only AI output works (no command)', async () => {
    const textGenerator = makeTextGenerator({
      text: 'Hello traveler.',
      structured: { narrative: 'Hello traveler.' },
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: 'Hi' }],
      signal: controller.signal,
    });

    expect(turn.narrative).toBe('Hello traveler.');
    expect(turn.command).toBeUndefined();
    expect(turn.choices.length).toBeGreaterThanOrEqual(1);
  });

  test('unknown command kind is dropped silently', async () => {
    const textGenerator = makeTextGenerator({
      text: 'Here is a secret.',
      structured: {
        narrative: 'Here is a secret.',
        command: { kind: 'teleport', target: 'mars' },
        choices: [],
      },
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
    });

    // Command should be dropped — teleport is not a valid kind
    expect(turn.command).toBeUndefined();
    expect(turn.narrative).toBe('Here is a secret.');
  });

  test('giveItem with item NPC does not possess — rejected by precondition', async () => {
    // Use a vendor whose inventory excludes legendarySword
    const contentProvider = makeContentProvider({
      npcs: {
        small_merchant: {
          name: 'Peddler',
          isVendor: true,
          vendorInventory: 'apple, bread',
        },
      },
    });
    const textGenerator = makeTextGenerator({
      text: 'Take this legendary sword.',
      structured: {
        narrative: 'Take this legendary sword.',
        command: { kind: 'giveItem', itemId: 'legendarySword', quantity: 1 },
        choices: [],
      },
    });
    npcDialogueService.configure({
      contentProvider,
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'small_merchant',
      npcName: 'Peddler',
      messages: [],
      signal: controller.signal,
    });

    // Command should be dropped — legendarySword is NOT in small_merchant's inventory
    expect(turn.command).toBeUndefined();
  });

  test('malformed JSON still returns narrative from streamed text', async () => {
    const textGenerator = makeTextGenerator({
      text: 'The guard nods slowly, his hand resting on his sword hilt.',
      structured: { kind: 'garbage' }, // not an envelope
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
    });

    // Should degrade to narrative-only — no crash
    expect(turn.narrative.length).toBeGreaterThan(0);
    expect(turn.source).toBe('ai');
  });

  test('one repair attempt on malformed envelope before fallback', async () => {
    // Envelope is missing narrative but has extra fields
    const textGenerator = makeTextGenerator({
      text: 'Greetings from the elder.', // will be used as repair narrative
      structured: {
        command: { kind: 'trade' },
        sideEffects: 'evil',
      },
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'traveling_merchant',
      npcName: 'Keth',
      messages: [],
      signal: controller.signal,
    });

    // Should succeed with repaired envelope
    expect(turn.narrative).toBe('Greetings from the elder.');
    expect(turn.command?.kind).toBe('trade');
    expect(turn.choices.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Precondition whitelist + command dispatch
// ---------------------------------------------------------------------------

describe('AC-3: Precondition whitelist and command dispatch', () => {
  test('deriveAllowedCommands for vendor', () => {
    const allowed = npcDialogueService.deriveAllowedCommands('traveling_merchant');
    expect(allowed).toContain('trade');
    expect(allowed).toContain('offerQuest');
    expect(allowed).toContain('skillCheck');
    expect(allowed).toContain('giveItem');
  });

  test('deriveAllowedCommands for combat NPC', () => {
    const allowed = npcDialogueService.deriveAllowedCommands('shade_guardian');
    expect(allowed).toContain('startCombat');
  });

  test('deriveAllowedCommands for non-combat NPC excludes startCombat', () => {
    const allowed = npcDialogueService.deriveAllowedCommands('village_elder');
    expect(allowed).not.toContain('startCombat');
  });

  test('AI-generated trade on vendor works', async () => {
    const textGenerator = makeTextGenerator({
      text: 'Let us trade.',
      structured: {
        narrative: 'Let us trade.',
        command: { kind: 'trade' },
      },
    });
    const contentProvider = makeContentProvider();
    const executors = makeExecutors();
    npcDialogueService.configure({
      contentProvider,
      textGenerator,
      executors,
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'traveling_merchant',
      npcName: 'Keth',
      messages: [],
      signal: controller.signal,
    });

    expect(turn.command?.kind).toBe('trade');
    expect(turn.narrative.length).toBeGreaterThan(0);

    // Verify executor dispatch: executeCommand routes through _executors
    expect(turn.command).toBeDefined();
    if (turn.command) {
      const executed = npcDialogueService.executeCommand({
        kind: 'trade',
        npcId: 'traveling_merchant',
        npcName: 'Keth',
        command: turn.command,
      });
      expect(executed).toBe(true);
      expect(execLog).toContain('trade');
    }
  });

  test('trade rejected on non-vendor NPC', async () => {
    const textGenerator = makeTextGenerator({
      text: 'Trade with me.',
      structured: {
        narrative: 'Trade with me.',
        command: { kind: 'trade' },
      },
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
    });

    // Trade command should be dropped — elder is not a vendor
    expect(turn.command).toBeUndefined();
    expect(turn.narrative).toBe('Trade with me.');
  });

  test('context projection includes allowedCommands whitelist', () => {
    const projection = npcDialogueService.buildContext({
      npcId: 'traveling_merchant',
      npcName: 'Keth',
      messages: [],
    });

    expect(projection.allowedCommands).toContain('trade');
    expect(projection.persona).toContain('Keth');
  });
});

// ---------------------------------------------------------------------------
// AC-4: Bounded AI personality via context projection
// ---------------------------------------------------------------------------

describe('AC-4: Context projection', () => {
  test('projection includes NPC persona and name', () => {
    const projection = npcDialogueService.buildContext({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: 'Hello' }],
    });

    expect(projection.npcName).toBe('Elder Thalia');
    expect(projection.persona.length).toBeGreaterThan(0);
    expect(projection.memory.length).toBeGreaterThanOrEqual(1);
  });

  test('memory window is bounded to last 10 messages', () => {
    const messages = Array.from({ length: 25 }, (_, index) => ({
      role: (index % 2 === 0 ? 'player' : 'npc') as 'player' | 'npc',
      content: `Message ${index}`,
    }));

    const projection = npcDialogueService.buildContext({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages,
    });

    expect(projection.memory.length).toBe(10);
  });

  test('gameStateFacts are included', () => {
    const projection = npcDialogueService.buildContext({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      gameStateFacts: ['Quest active: The Fading Ward', 'Player level: 3'],
    });

    expect(projection.gameStateFacts).toContain('Quest active: The Fading Ward');
  });
});

// ---------------------------------------------------------------------------
// AC-5: Cancellation, regenerate, edit safety
// ---------------------------------------------------------------------------

describe('AC-5: Cancellation and regenerate safety', () => {
  test('cancellation aborts and falls to authored', async () => {
    // Generator that hangs until aborted
    const textGenerator: ReturnType<typeof makeTextGenerator> = mock(
      async (_opts: { signal?: AbortSignal }) => {
        // Wait for abort
        await new Promise<void>((_resolve, reject) => {
          _opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
        return { text: 'never' };
      },
    );

    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();

    const turnPromise = npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
    });

    // Cancel immediately
    controller.abort();

    const turn = await turnPromise;
    expect(turn.source).toBe('authored');
    expect(turn.narrative.length).toBeGreaterThan(0);
  });

  test('markCommandExecuted prevents re-execution check', () => {
    npcDialogueService.markCommandExecuted('turn-1', 'giveItem');
    expect(npcDialogueService.wasCommandExecuted('turn-1')).toBe(true);
    expect(npcDialogueService.wasCommandExecuted('turn-2')).toBe(false);
  });

  test('concurrent sends cancel the first', async () => {
    let callCount = 0;

    const textGenerator: ReturnType<typeof makeTextGenerator> = mock(
      async (_opts: { signal?: AbortSignal }) => {
        callCount++;
        if (callCount === 1) {
          // First call: hang until signal aborts
          await new Promise<void>((_resolve, reject) => {
            _opts.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          });
          return { text: 'never' };
        }
        // Second call: fast reply
        return { text: 'Fast reply' };
      },
    );

    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller1 = new AbortController();
    const controller2 = new AbortController();

    // Start first — this will hang
    const promise1 = npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller1.signal,
    });

    // Give it a tick to start hanging
    await new Promise((r) => setTimeout(r, 50));

    // Start second — the concurrency gate in generateTurn cancels the first
    const promise2 = npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller2.signal,
    });

    const turn2 = await promise2;
    expect(turn2.narrative).toBe('Fast reply');
    expect(turn2.source).toBe('ai');

    // First should have fallen back to authored
    const turn1 = await promise1;
    expect(turn1.source).toBe('authored');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  test('choices capped at 4', async () => {
    const textGenerator = makeTextGenerator({
      text: 'Here are many options.',
      structured: {
        narrative: 'Here are many options.',
        choices: [
          { id: 'a', label: 'Option A' },
          { id: 'b', label: 'Option B' },
          { id: 'c', label: 'Option C' },
          { id: 'd', label: 'Option D' },
          { id: 'e', label: 'Option E' },
          { id: 'f', label: 'Option F' },
        ],
      },
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
    });

    // Choices should be capped at 4 even when 6 are provided
    expect(turn.choices.length).toBeLessThanOrEqual(4);
    expect(turn.narrative).toBe('Here are many options.');
  });

  test('configure must be called before generateTurn (throws on unconfigured)', () => {
    // Create a fresh, unconfigured instance
    const freshService = NpcDialogueService.create({ className: 'NpcDialogueServiceTest' });

    const controller = new AbortController();
    expect(async () =>
      freshService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [],
        signal: controller.signal,
      }),
    ).toThrow('not configured');
  });
});

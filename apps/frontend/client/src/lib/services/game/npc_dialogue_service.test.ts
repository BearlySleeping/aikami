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
import { questStateService } from '$services';
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
    getQuest: mock((questId: string) => data.quests.find((q) => q.id === questId)),
    getAllQuests: mock(() => data.quests),
    getAllEncounters: mock(() => data.encounters),
    getEncounter: mock((encounterId: string) => data.encounters.find((e) => e.id === encounterId)),
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

const makeTextGenerator = (options?: { text?: string; structured?: unknown; error?: Error }) =>
  mock(async (_opts: Record<string, unknown>) => {
    if (options?.error) {
      throw options.error;
    }
    return {
      text: options?.text ?? 'Hello.',
      structured: options?.structured,
    };
  });

/**
 * Two-call-aware generator: call 1 (no schema) streams `chunks` via
 * onChunk; call 2 (schema) returns the structured envelope (or throws).
 * C-401: mirrors the split production glue.
 */
const makeStreamingTextGenerator = (options?: {
  chunks?: string[];
  structured?: unknown;
  call2Error?: Error;
  /** Call 1 never resolves — used for the AC-4 timeout test. */
  neverResolve?: boolean;
  /** Emits this many chunks on call 1, then never resolves (stall-after-chunks). */
  stallAfterChunks?: number;
}) => {
  const chunks = options?.chunks ?? [];
  return mock(async (opts: Record<string, unknown>) => {
    const onChunk = opts.onChunk as ((text: string) => void) | undefined;
    if (opts.schema) {
      // Call 2 — envelope extraction
      if (options?.call2Error) {
        throw options.call2Error;
      }
      return { text: chunks.join(''), structured: options?.structured };
    }
    // Call 1 — narrative streaming
    if (options?.neverResolve) {
      await new Promise<void>(() => {});
    }
    const emitCount = options?.stallAfterChunks ?? chunks.length;
    for (let i = 0; i < emitCount; i++) {
      onChunk?.(chunks[i]);
    }
    if (options?.stallAfterChunks !== undefined && emitCount < chunks.length) {
      // Emitted the requested prefix, then the provider hangs mid-stream.
      await new Promise<void>(() => {});
    }
    return { text: chunks.join('') };
  });
};

/** Asserts a promise rejects with an AbortError-shaped error (AC-3). */
const expectAbortRejection = async (promise: Promise<unknown>): Promise<void> => {
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    rejected = (error as Error)?.name === 'AbortError' || /abort/i.test(String(error));
  }
  expect(rejected).toBe(true);
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
  test('cancellation aborts and rejects (AC-3: no authored fallback on abort)', async () => {
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

    // Cancel immediately — abort rejects, no authored fallback is written
    controller.abort();

    await expectAbortRejection(turnPromise);
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('aborted');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(false);
    }
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

    // First should reject with AbortError — the concurrency gate cancelled it
    await expectAbortRejection(promise1);
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

// ---------------------------------------------------------------------------
// startDialogue — greeting resolution + initial suggestions
// ---------------------------------------------------------------------------

describe('startDialogue', () => {
  test('resolves the dialogue KEY to authored text via the content provider', () => {
    const contentProvider = makeContentProvider();
    npcDialogueService.configure({
      contentProvider,
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });

    npcDialogueService.startDialogue({
      npcData: { npcId: 'village_elder', npcName: 'Elder Thalia', dialog: 'elder_thalia_greeting' },
      setOverlay: () => {},
      pauseEngine: () => {},
    });

    expect(npcDialogueService.activeNpc?.dialog).toBe(
      '"Greetings, traveler. Our village has need of your aid."',
    );
  });

  test('passes plain dialog text through unchanged when not a dialogue key', () => {
    const contentProvider = makeContentProvider();
    npcDialogueService.configure({
      contentProvider,
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });

    npcDialogueService.startDialogue({
      npcData: {
        npcId: 'sandbox-elder',
        npcName: 'Elder Thrain',
        dialog: 'Ah, a traveler! Welcome to our humble village.',
      },
      setOverlay: () => {},
      pauseEngine: () => {},
    });

    expect(npcDialogueService.activeNpc?.dialog).toBe(
      'Ah, a traveler! Welcome to our humble village.',
    );
  });

  test('attaches the NPC authored initial suggestions to the session', () => {
    const contentProvider = makeContentProvider({
      npcs: {
        village_elder: {
          name: 'Elder Thalia',
          defaultDialogueKey: 'elder_thalia_greeting',
          initialSuggestions: [
            {
              id: 'elder_ask_ward',
              label: 'Ask about the ward',
              intentType: 'quest',
              prefillText: 'Can you tell me about the fading ward?',
            },
          ],
        },
      },
    });
    npcDialogueService.configure({
      contentProvider,
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });

    npcDialogueService.startDialogue({
      npcData: { npcId: 'village_elder', npcName: 'Elder Thalia', dialog: 'elder_thalia_greeting' },
      setOverlay: () => {},
      pauseEngine: () => {},
    });

    expect(npcDialogueService.activeNpc?.initialSuggestions?.[0]?.id).toBe('elder_ask_ward');
  });

  test('keeps the caller-supplied initialSuggestions over the content lookup', () => {
    npcDialogueService.startDialogue({
      npcData: {
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        dialog: 'Hello.',
        initialSuggestions: [
          {
            id: 'custom_chip',
            label: 'Custom',
            intentType: 'dialogue',
            prefillText: 'A caller-provided chip takes priority over the content pack.',
          },
        ],
      },
      setOverlay: () => {},
      pauseEngine: () => {},
    });

    expect(npcDialogueService.activeNpc?.initialSuggestions?.[0]?.id).toBe('custom_chip');
  });

  test('works unconfigured (plain dialog, no suggestions) without throwing', () => {
    const freshService = NpcDialogueService.create({ className: 'NpcDialogueServiceTest' });
    freshService.startDialogue({
      npcData: { npcId: 'x', npcName: 'X', dialog: 'plain text' },
      setOverlay: () => {},
      pauseEngine: () => {},
    });
    expect(freshService.activeNpc?.dialog).toBe('plain text');
    expect(freshService.activeNpc?.initialSuggestions).toBeUndefined();
  });
});

describe('Quest-activation fallback (AI unavailable)', () => {
  const originalGetOfferableQuests = (
    questStateService as unknown as {
      getOfferableQuests: (npcId: string) => Array<{ id: string; name: string }>;
    }
  ).getOfferableQuests;

  afterEach(() => {
    // Restore the preload-mocked questStateService behavior.
    (
      questStateService as unknown as {
        getOfferableQuests: (npcId: string) => Array<{ id: string; name: string }>;
      }
    ).getOfferableQuests = originalGetOfferableQuests;
  });

  const stubOfferableQuests = (quests: Array<{ id: string; name: string }>): void => {
    (
      questStateService as unknown as {
        getOfferableQuests: (npcId: string) => Array<{ id: string; name: string }>;
      }
    ).getOfferableQuests = () => quests;
  };

  const runFallbackAnalyze = (playerInput: string) => {
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator: makeTextGenerator({ error: new Error('AI unavailable') }),
      executors: makeExecutors(),
    });
    return npcDialogueService.analyzeIntent({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: playerInput }],
      signal: new AbortController().signal,
    });
  };

  test('accepts the sole offerable quest when the player clearly accepts', async () => {
    stubOfferableQuests([{ id: 'fading_ward', name: 'The Fading Ward' }]);
    const output = await runFallbackAnalyze('Consider it done, I accept the quest, elder.');
    expect(output.questActivation).toEqual({ action: 'accept', questId: 'fading_ward' });
  });

  test('declines the sole offerable quest when the player clearly declines', async () => {
    stubOfferableQuests([{ id: 'fading_ward', name: 'The Fading Ward' }]);
    const output = await runFallbackAnalyze('No thanks, I cannot take on this quest.');
    expect(output.questActivation).toEqual({ action: 'decline', questId: 'fading_ward' });
  });

  test('does not activate when the NPC has no offerable quest', async () => {
    stubOfferableQuests([]);
    const output = await runFallbackAnalyze('I accept the quest, elder.');
    expect(output.questActivation).toBeUndefined();
  });

  test('does not activate when multiple quests are offerable (ambiguous)', async () => {
    stubOfferableQuests([
      { id: 'fading_ward', name: 'The Fading Ward' },
      { id: 'second_quest', name: 'The Second Quest' },
    ]);
    const output = await runFallbackAnalyze('Consider it done, I accept the quest, elder.');
    // Ambiguity guard: with more than one offerable quest the fallback must
    // not guess which one the player means.
    expect(output.questActivation).toBeUndefined();
  });

  test('does not activate on ordinary conversation about the quest', async () => {
    stubOfferableQuests([{ id: 'fading_ward', name: 'The Fading Ward' }]);
    const output = await runFallbackAnalyze('Tell me more about this quest.');
    expect(output.questActivation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C-401: two-call split + streaming + timeout + degrade (AC-1/4/5/6/7)
// ---------------------------------------------------------------------------

describe('C-401: two-call narrative streaming', () => {
  test('call 1 streams narrative (no schema), call 2 extracts envelope (schema)', async () => {
    const calls: Array<{ schema?: unknown; onChunk?: unknown }> = [];
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      calls.push({ schema: opts.schema, onChunk: opts.onChunk });
      if (opts.schema) {
        return {
          text: 'The elder nods.',
          structured: {
            narrative: 'The elder nods.',
            command: { kind: 'offerQuest', questId: 'fading_ward' },
          },
        };
      }
      (opts.onChunk as ((t: string) => void) | undefined)?.('The elder ');
      (opts.onChunk as ((t: string) => void) | undefined)?.('nods.');
      return { text: 'The elder nods.' };
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
      messages: [{ role: 'player', content: 'Hello' }],
      signal: controller.signal,
    });

    // Exactly two calls: narrative (no schema) then envelope (schema)
    expect(calls.length).toBe(2);
    expect(calls[0].schema).toBeUndefined();
    expect(typeof calls[0].onChunk).toBe('function');
    expect(calls[1].schema).toBeDefined();
    expect(calls[1].onChunk).toBeUndefined();

    // The streamed narrative is authoritative
    expect(turn.narrative).toBe('The elder nods.');
    expect(turn.command?.kind).toBe('offerQuest');
    expect(turn.source).toBe('ai');
  });

  test('onChunk reaches the caller with incremental tokens (AC-1)', async () => {
    const chunks: string[] = [];
    const textGenerator = makeStreamingTextGenerator({
      chunks: ['Hello', ' traveler', ', welcome!'],
      structured: { narrative: 'Hello traveler, welcome!' },
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
      onChunk: (text) => chunks.push(text),
    });

    expect(chunks).toEqual(['Hello', ' traveler', ', welcome!']);
    expect(turn.narrative).toBe('Hello traveler, welcome!');
    // turnState completes with the streamed text
    expect(npcDialogueService.turnState.kind).toBe('complete');
    if (npcDialogueService.turnState.kind === 'complete') {
      expect(npcDialogueService.turnState.text).toBe('Hello traveler, welcome!');
    }
  });

  test('non-streaming provider never enters streaming state and completes in one step (AC-6)', async () => {
    // Generator never invokes onChunk — single non-streamed response
    const textGenerator = makeTextGenerator({
      text: 'A single reply.',
      structured: { narrative: 'A single reply.' },
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

    expect(turn.narrative).toBe('A single reply.');
    // State went idle → awaiting_envelope → complete; never streaming
    expect(npcDialogueService.turnState.kind).toBe('complete');
    expect(turn.source).toBe('ai');
  });

  test('timeout reaches failed with reason timeout and fallbackOffered true (AC-4)', async () => {
    const textGenerator = makeStreamingTextGenerator({ neverResolve: true });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
      timeoutMs: 60,
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
    });

    // Authored fallback is offered as the recovery
    expect(turn.source).toBe('authored');
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('timeout');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(true);
    }
  });

  test('timeout after partial stream stops chunk delivery and fails the turn (AC-4)', async () => {
    const delivered: string[] = [];
    const textGenerator = makeStreamingTextGenerator({
      chunks: ['The guard ', 'shifts, ', 'and speaks.'],
      stallAfterChunks: 2, // emit two chunks, then hang
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
      timeoutMs: 60,
    });

    const controller = new AbortController();
    const turn = await npcDialogueService.generateTurn({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
      onChunk: (text) => delivered.push(text),
    });

    // The two pre-stall chunks reached the caller, then delivery stopped.
    expect(delivered.join('')).toBe('The guard shifts, ');

    // The turn fails as a timeout with the authored fallback offered; the
    // failed turn state is not regressed by any late chunk.
    expect(turn.source).toBe('authored');
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('timeout');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(true);
    }
  });

  test('call 2 failure degrades to narrative-only, never discards streamed text (AC-7)', async () => {
    const textGenerator = makeStreamingTextGenerator({
      chunks: ['The guard ', 'steps aside.'],
      call2Error: new Error('extraction backend exploded'),
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

    // Streamed narrative kept; derived (non-empty) choices; no authored replacement
    expect(turn.narrative).toBe('The guard steps aside.');
    expect(turn.source).toBe('ai');
    expect(turn.choices.length).toBeGreaterThan(0);
    expect(turn.choices.length).toBeLessThanOrEqual(4);
    expect(turn.command).toBeUndefined();
    expect(npcDialogueService.turnState.kind).toBe('complete');
  });

  test('malformed call 2 envelope degrades to narrative-only (AC-7)', async () => {
    const textGenerator = makeStreamingTextGenerator({
      chunks: ['The elder smiles warmly.'],
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

    expect(turn.narrative).toBe('The elder smiles warmly.');
    expect(turn.source).toBe('ai');
    expect(turn.choices.length).toBeGreaterThan(0);
  });

  test('abort during call 2 rejects (AC-3 watch point: both calls cancel)', async () => {
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as ((t: string) => void) | undefined;
      const signal = opts.signal as AbortSignal | undefined;
      if (opts.schema) {
        // Call 2: hang until abort
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
        return { text: '', structured: undefined };
      }
      // Call 1: stream fully, then resolve
      onChunk?.('First half');
      onChunk?.(' second half');
      return { text: 'First half second half' };
    });
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

    // Give call 1 a tick to finish streaming, then abort during call 2
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expectAbortRejection(turnPromise);
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('aborted');
    }
  });

  test('instrumentation logs time-to-first-token and total turn time (AC-5)', async () => {
    const infoSpy = mock(() => {});
    const warnSpy = mock(() => {});
    const service = npcDialogueService as unknown as {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
    };
    const originalInfo = service.info;
    const originalWarn = service.warn;
    service.info = infoSpy;
    service.warn = warnSpy;

    try {
      const textGenerator = makeStreamingTextGenerator({
        chunks: ['The elder ', 'nods.'],
        structured: { narrative: 'The elder nods.' },
      });
      npcDialogueService.configure({
        contentProvider: makeContentProvider(),
        textGenerator,
        executors: makeExecutors(),
      });

      const controller = new AbortController();
      await npcDialogueService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [],
        signal: controller.signal,
      });

      const logged = infoSpy.mock.calls.map((call) => String(call[0]));
      expect(logged.some((entry) => entry.startsWith('dialogue:ttft'))).toBe(true);
      expect(logged.some((entry) => entry.startsWith('dialogue:turn-time'))).toBe(true);
    } finally {
      service.info = originalInfo;
      service.warn = originalWarn;
    }
  });

  test('analyzeIntent streams the pre-roll narrative and returns it as npcResponse (AC-2)', async () => {
    const chunks: string[] = [];
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (opts.schema) {
        return {
          text: 'The elder studies you.',
          structured: {
            requiresRoll: true,
            checkType: 'persuasion',
            difficultyClass: 12,
            modifierSource: 'CHA',
            npcResponse: 'The elder studies you.',
            suggestedChips: [],
          },
        };
      }
      (opts.onChunk as ((t: string) => void) | undefined)?.('The elder ');
      (opts.onChunk as ((t: string) => void) | undefined)?.('studies you.');
      return { text: 'The elder studies you.' };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const output = await npcDialogueService.analyzeIntent({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: 'I try to persuade you.' }],
      signal: controller.signal,
      onChunk: (text) => chunks.push(text),
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(output.npcResponse).toBe('The elder studies you.');
    expect(output.requiresRoll).toBe(true);
    expect(output.checkType).toBe('persuasion');
    expect(npcDialogueService.turnState.kind).toBe('complete');
  });

  test('resolveRoll streams the resolution narrative and applies deltas (AC-2)', async () => {
    const chunks: string[] = [];
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (opts.schema) {
        return {
          text: 'Your words carry weight.',
          structured: {
            narrativeResult: 'Your words carry weight.',
            stateDeltas: [{ kind: 'trust_change', target: 'npc-001', value: 2 }],
            suggestedChips: [],
          },
        };
      }
      (opts.onChunk as ((t: string) => void) | undefined)?.('Your words ');
      (opts.onChunk as ((t: string) => void) | undefined)?.('carry weight.');
      return { text: 'Your words carry weight.' };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    const output = await npcDialogueService.resolveRoll({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
      checkType: 'persuasion',
      difficultyClass: 12,
      rollTotal: 18,
      outcome: 'pass',
      playerInput: 'I appeal to your honor.',
      onChunk: (text) => chunks.push(text),
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(output.narrativeResult).toBe('Your words carry weight.');
    expect(output.stateDeltas.length).toBe(1);
    expect(npcDialogueService.turnState.kind).toBe('complete');
  });

  test('resolveRoll prompt carries the result AND the non-contradiction instruction (C-421 AC-3)', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      // Capture the narrative streaming call (no schema) — call 1.
      if (!opts.schema) {
        capturedMessages = (opts.messages as Array<{ role: string; content: string }>) ?? [];
      }
      if (opts.schema) {
        return {
          text: 'Your words carry weight.',
          structured: {
            narrativeResult: 'Your words carry weight.',
            stateDeltas: [],
            suggestedChips: [],
          },
        };
      }
      return { text: 'Your words carry weight.' };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    await npcDialogueService.resolveRoll({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: controller.signal,
      checkType: 'persuasion',
      difficultyClass: 12,
      rollTotal: 8,
      outcome: 'fail',
      playerInput: 'I appeal to your honor.',
    });

    const systemPrompt = capturedMessages.find((m) => m.role === 'system')?.content ?? '';
    const userPrompt = capturedMessages.find((m) => m.role === 'user')?.content ?? '';

    // The mechanical result is injected as ground truth.
    expect(userPrompt).toContain('DC=12');
    expect(userPrompt).toContain('Roll=8');
    expect(userPrompt).toContain('FAILURE');

    // The system prompt carries the explicit non-contradiction instruction.
    expect(systemPrompt).toContain('MUST NOT contradict');
    expect(systemPrompt).toContain('authoritative');
  });
});

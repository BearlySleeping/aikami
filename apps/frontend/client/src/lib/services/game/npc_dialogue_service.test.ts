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
import type { NpcRollResolutionOutput, NpcStateDelta } from '@aikami/types';
import { encode } from 'gpt-tokenizer';
import { relationshipService } from '$services';
import type { ConsequenceRequest, ConsequenceResult } from '$types';
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
  quests: [
    {
      id: 'fading_ward',
      name: 'The Fading Ward',
      offerDialogueKey: 'elder_thalia_offer',
      endings: {
        renewed: { worldStateFlag: 'emberwatch.ending.renewed' },
      },
    },
  ],
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
  Reflect.deleteProperty(globalThis, '__AIKAMI_E2E_DIALOGUE_INTENT__');
  // Reconfigure with fresh state to prevent test bleed
  const contentProvider = makeContentProvider();
  const textGenerator = makeTextGenerator();
  npcDialogueService.configure({
    contentProvider,
    textGenerator,
    executors: makeExecutors(),
  });
});

describe('E2E intent seed', () => {
  test('validates the seed and completes a previously failed turn', async () => {
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator: makeTextGenerator({ error: new Error('provider unavailable') }),
      executors: makeExecutors(),
    });
    const controller = new AbortController();
    const options = {
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player' as const, content: 'Hello.' }],
      signal: controller.signal,
    };

    await expect(npcDialogueService.analyzeIntent(options)).rejects.toThrow('provider unavailable');
    expect(npcDialogueService.turnState.kind).toBe('failed');

    (globalThis as Record<string, unknown>).__AIKAMI_E2E_DIALOGUE_INTENT__ = {
      requiresRoll: false,
      checkType: undefined,
      difficultyClass: undefined,
      modifierSource: undefined,
      npcResponse: 'A fine day to you, traveler.',
      suggestedChips: [],
    };

    const output = await npcDialogueService.analyzeIntent(options);

    expect(output.npcResponse).toBe('A fine day to you, traveler.');
    expect(npcDialogueService.turnState).toEqual({
      kind: 'complete',
      text: 'A fine day to you, traveler.',
    });
  });

  test('ignores a seed that does not satisfy the intent schema', async () => {
    (globalThis as Record<string, unknown>).__AIKAMI_E2E_DIALOGUE_INTENT__ = {
      requiresRoll: false,
    };
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator: makeTextGenerator({ error: new Error('real pipeline reached') }),
      executors: makeExecutors(),
    });

    await expect(
      npcDialogueService.analyzeIntent({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [{ role: 'player', content: 'Hello.' }],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('real pipeline reached');
  });
});

// ---------------------------------------------------------------------------
// AC-1: Provider failure surfaces an error (no authored fallback)
// ---------------------------------------------------------------------------

describe('AC-1: Provider failure surfaces an error', () => {
  test('rejects when the text generator throws', async () => {
    const contentProvider = makeContentProvider();
    const textGenerator = makeTextGenerator({ error: new Error('connection refused') });
    npcDialogueService.configure({
      contentProvider,
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    await expect(
      npcDialogueService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [{ role: 'player', content: 'Hello' }],
        signal: controller.signal,
      }),
    ).rejects.toThrow('connection refused');

    // The failure is recorded on turnState — never faked as authored.
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('provider_error');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(false);
    }
  });

  test('rejects for an NPC without defaultDialogueKey', async () => {
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
    await expect(
      npcDialogueService.generateTurn({
        npcId: 'bob',
        npcName: 'Bob',
        messages: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow('no capability');
  });

  test('analyzeIntent: call 1 succeeds, call 2 throws — recovers from the streamed narrative (C-499 AC-1)', async () => {
    const textGenerator = makeStreamingTextGenerator({
      chunks: ['The elder considers your words.'],
      call2Error: new Error('No JSON object found in response'),
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
    });

    // The turn completes — it does NOT fail — using the recovered narrative.
    expect(output.requiresRoll).toBe(false);
    expect(output.npcResponse).toContain('The elder considers your words.');
    // A pure-prose narrative recovers zero chips (C-499 edge case: chips are
    // not guaranteed by the repair path — the empty-body retry in AC-2 is what
    // restores the combat-chip envelope).
    expect(output.suggestedChips).toEqual([]);
    expect(npcDialogueService.turnState.kind).toBe('complete');
  });

  test('analyzeIntent: repair itself fails when the narrative is too short — surfaces the real error (C-499 AC-3)', async () => {
    const textGenerator = makeStreamingTextGenerator({
      chunks: ['Hi.'],
      call2Error: new Error('No JSON object found in response'),
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    // The streamed narrative "Hi." is < 20 chars, so recoverIntentAnalysisOutput
    // throws; analyzeIntent surfaces the original provider error while retaining
    // the repair error as its cause (AC-3: no silent/endless turn).
    await expect(
      npcDialogueService.analyzeIntent({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [{ role: 'player', content: 'I try to persuade you.' }],
        signal: controller.signal,
      }),
    ).rejects.toThrow('No JSON object found in response');

    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('provider_error');
    }
  });

  test('resolveRoll: call 1 succeeds, call 2 rejects — propagates error and sets failed turn state', async () => {
    const textGenerator = makeStreamingTextGenerator({
      chunks: ['The elder watches as you roll.'],
      call2Error: new Error('envelope extraction failed'),
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const controller = new AbortController();
    await expect(
      npcDialogueService.resolveRoll({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [],
        signal: controller.signal,
        checkType: 'persuasion',
        difficultyClass: 12,
        rollTotal: 15,
        outcome: 'pass',
        playerInput: 'I appeal to your honor.',
      }),
    ).rejects.toThrow('envelope extraction failed');

    // Both the rejection AND the failed turn state must be present
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('provider_error');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(false);
    }
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

  test('timeout rejects with reason timeout and no fallback offered (AC-4)', async () => {
    const textGenerator = makeStreamingTextGenerator({ neverResolve: true });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
      timeoutMs: 60,
    });

    const controller = new AbortController();
    await expect(
      npcDialogueService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow('timed out');

    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('timeout');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(false);
    }
  });

  test('timeout after partial stream stops chunk delivery and rejects the turn (AC-4)', async () => {
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
    await expect(
      npcDialogueService.generateTurn({
        npcId: 'village_elder',
        npcName: 'Elder Thalia',
        messages: [],
        signal: controller.signal,
        onChunk: (text) => delivered.push(text),
      }),
    ).rejects.toThrow('timed out');

    // The two pre-stall chunks reached the caller, then delivery stopped.
    expect(delivered.join('')).toBe('The guard shifts, ');

    // The turn fails as a timeout with no fallback; the failed turn state is
    // not regressed by any late chunk.
    expect(npcDialogueService.turnState.kind).toBe('failed');
    if (npcDialogueService.turnState.kind === 'failed') {
      expect(npcDialogueService.turnState.reason).toBe('timeout');
      expect(npcDialogueService.turnState.fallbackOffered).toBe(false);
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

// ---------------------------------------------------------------------------
// C-488 AC-3: authored NPC identity in the production persona
// ---------------------------------------------------------------------------

describe('C-488 AC-3: authored identity in the production persona', () => {
  const AUTHORED_ELDER = {
    name: 'Elder Thalia',
    defaultDialogueKey: 'elder_thalia_greeting',
    personality: { voice: 'Measured and warm.', manner: 'Patient and authoritative.' },
    agenda: ["Keep the Ward Wand sealed in Emberwatch's shrine."],
    knowledge: ['The Ward Wand is a Vesperine relic.'],
    secrets: ['She fears old enemies have breached the valley.'],
    boundaries: ["She will not risk Emberwatch on a stranger's promise."],
  };

  test('buildContext persona includes every authored identity field', () => {
    const contentProvider = makeContentProvider({ npcs: { authored_elder: AUTHORED_ELDER } });
    npcDialogueService.configure({
      contentProvider,
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });

    const projection = npcDialogueService.buildContext({
      npcId: 'authored_elder',
      npcName: 'Elder Thalia',
      messages: [],
    });

    expect(projection.persona).toContain('Measured and warm.');
    expect(projection.persona).toContain('Patient and authoritative.');
    expect(projection.persona).not.toContain(
      'You are Elder Thalia, a character in a fantasy world.',
    );
    expect(projection.persona).toContain("Keep the Ward Wand sealed in Emberwatch's shrine.");
    expect(projection.persona).toContain('The Ward Wand is a Vesperine relic.');
    expect(projection.persona).toContain('She fears old enemies have breached the valley.');
    expect(projection.persona).toContain("She will not risk Emberwatch on a stranger's promise.");
  });

  test('missing personality yields the exact canonical generic sentence', () => {
    const contentProvider = makeContentProvider(); // village_elder has no identity
    npcDialogueService.configure({
      contentProvider,
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });

    const projection = npcDialogueService.buildContext({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
    });

    expect(projection.persona).toBe('You are Elder Thalia, a character in a fantasy world.');
  });

  test('per-field fallback: each missing array field omits only its labelled block', () => {
    const contentProvider = makeContentProvider({
      npcs: {
        partial: { name: 'Partial', agenda: ['Get the wand.'] },
      },
    });
    npcDialogueService.configure({
      contentProvider,
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });

    const projection = npcDialogueService.buildContext({
      npcId: 'partial',
      npcName: 'Partial',
      messages: [],
    });
    const persona = projection.persona;

    expect(persona).toContain('You are Partial, a character in a fantasy world.');
    expect(persona).toContain('[AGENDA]');
    expect(persona).toContain('Get the wand.');
    expect(persona).not.toContain('[KNOWLEDGE]');
    expect(persona).not.toContain('[SECRETS]');
    expect(persona).not.toContain('[BOUNDARIES]');
    expect(persona).not.toContain('Voice:');
  });

  test('analyzeIntent sends the authored persona in npcContext.persona', async () => {
    let capturedInput = '';
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (!opts.schema) {
        const messages = (opts.messages as Array<{ role: string; content: string }>) ?? [];
        capturedInput = messages.find((m) => m.role === 'user')?.content ?? '';
        return { text: 'The elder considers.' };
      }
      return {
        text: 'The elder considers.',
        structured: {
          requiresRoll: false,
          npcResponse: 'The elder considers.',
          suggestedChips: [],
        },
      };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider({ npcs: { authored_elder: AUTHORED_ELDER } }),
      textGenerator,
      executors: makeExecutors(),
    });

    await npcDialogueService.analyzeIntent({
      npcId: 'authored_elder',
      npcName: 'Elder Thalia',
      messages: [{ role: 'player', content: 'Hello' }],
      signal: new AbortController().signal,
    });

    const input = JSON.parse(capturedInput) as { npcContext: { persona: string } };
    expect(input.npcContext.persona).toContain('Measured and warm.');
    expect(input.npcContext.persona).toContain("Keep the Ward Wand sealed in Emberwatch's shrine.");
  });
});

// ---------------------------------------------------------------------------
// C-488 AC-4: resolveRoll receives the same facts + history as analyzeIntent
// ---------------------------------------------------------------------------

describe('C-488 AC-4: resolveRoll receives the same facts', () => {
  test('resolveRoll prompt contains persona, gameStateFacts, and recent history', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (!opts.schema) {
        const messages = (opts.messages as Array<{ role: string; content: string }>) ?? [];
        capturedSystem = messages.find((m) => m.role === 'system')?.content ?? '';
        capturedUser = messages.find((m) => m.role === 'user')?.content ?? '';
        return { text: 'Done.' };
      }
      return {
        text: 'Done.',
        structured: { narrativeResult: 'Done.', stateDeltas: [], suggestedChips: [] },
      };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    await npcDialogueService.resolveRoll({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [
        { role: 'player', content: 'Please hand it over.' },
        { role: 'npc', content: 'No.' },
      ],
      signal: new AbortController().signal,
      gameStateFacts: ['Quest active: The Fading Ward'],
      checkType: 'persuasion',
      difficultyClass: 12,
      rollTotal: 15,
      outcome: 'pass',
      playerInput: 'I appeal to your honor.',
    });

    // Persona (generic fallback for the identity-less village_elder).
    expect(capturedSystem).toContain('You are Elder Thalia, a character in a fantasy world.');
    // The same facts the intent prompt receives.
    expect(capturedUser).toContain('[GAME STATE]');
    expect(capturedUser).toContain('Quest active: The Fading Ward');
    expect(capturedUser).toContain('[CONVERSATION HISTORY]');
    expect(capturedUser).toContain('Player: Please hand it over.');
  });
});

// ---------------------------------------------------------------------------
// C-488 AC-6: prompt budget within 4,096 cl100k_base tokens
// ---------------------------------------------------------------------------

describe('C-488 AC-6: prompt budget (cl100k_base)', () => {
  const TOKEN_MODEL = 'cl100k_base' as const;
  const TOKEN_BUDGET = 4096;

  const countTokens = (text: string): number => encode(text, { model: TOKEN_MODEL }).length;
  const manifestUrl = new URL(
    '../../../../../../../content/packs/emberwatch/manifest.json',
    import.meta.url,
  );

  const stripIdentity = (npc: Record<string, unknown>): Record<string, unknown> => {
    const stripped = { ...npc };
    delete stripped.personality;
    delete stripped.agenda;
    delete stripped.knowledge;
    delete stripped.secrets;
    delete stripped.boundaries;
    return stripped;
  };

  const captureContextPrompt = async (
    npcId: string,
    npcName: string,
    npcEntry: Record<string, unknown>,
  ): Promise<string> => {
    let captured = '';
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (!opts.schema) {
        const messages = (opts.messages as Array<{ role: string; content: string }>) ?? [];
        captured = messages.find((m) => m.role === 'system')?.content ?? '';
        return { text: 'Hello.' };
      }
      return { text: 'Hello.', structured: { narrative: 'Hello.' } };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider({ npcs: { [npcId]: npcEntry } }),
      textGenerator,
      executors: makeExecutors(),
    });
    await npcDialogueService.generateTurn({
      npcId,
      npcName,
      messages: [],
      signal: new AbortController().signal,
    });
    return captured;
  };

  const captureRollPrompt = async (
    npcId: string,
    npcName: string,
    npcEntry: Record<string, unknown>,
  ): Promise<string> => {
    let system = '';
    let user = '';
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (!opts.schema) {
        const messages = (opts.messages as Array<{ role: string; content: string }>) ?? [];
        system = messages.find((m) => m.role === 'system')?.content ?? '';
        user = messages.find((m) => m.role === 'user')?.content ?? '';
        return { text: 'Done.' };
      }
      return {
        text: 'Done.',
        structured: { narrativeResult: 'Done.', stateDeltas: [], suggestedChips: [] },
      };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider({ npcs: { [npcId]: npcEntry } }),
      textGenerator,
      executors: makeExecutors(),
    });
    await npcDialogueService.resolveRoll({
      npcId,
      npcName,
      messages: [],
      signal: new AbortController().signal,
      gameStateFacts: [],
      checkType: 'persuasion',
      difficultyClass: 12,
      rollTotal: 15,
      outcome: 'pass',
      playerInput: 'I appeal to your honor.',
    });
    return `${system}\n${user}`;
  };

  test('every after-count stays <= 4096 cl100k_base tokens for all three NPCs', async () => {
    const manifest = (await Bun.file(manifestUrl).json()) as {
      npcs: Record<string, Record<string, unknown>>;
    };

    for (const expectedNpcId of ['village_elder', 'rollo_grasper', 'merchant']) {
      expect(manifest.npcs[expectedNpcId], `${expectedNpcId} exists`).toBeDefined();
    }

    for (const [npcId, npc] of Object.entries(manifest.npcs)) {
      const npcName = (npc.name as string) ?? npcId;
      const generic = stripIdentity(npc);

      const contextBefore = countTokens(await captureContextPrompt(npcId, npcName, generic));
      const contextAfter = countTokens(await captureContextPrompt(npcId, npcName, npc));
      const rollBefore = countTokens(await captureRollPrompt(npcId, npcName, generic));
      const rollAfter = countTokens(await captureRollPrompt(npcId, npcName, npc));

      // Budget assertions on the after counts only (identity displaces filler).
      expect(contextAfter, `${npcId} context-projection after count`).toBeLessThanOrEqual(
        TOKEN_BUDGET,
      );
      expect(rollAfter, `${npcId} resolveRoll after count`).toBeLessThanOrEqual(TOKEN_BUDGET);

      // The after count must not blow the ceiling the before count never reached.
      expect(contextBefore, `${npcId} context-projection before count`).toBeLessThanOrEqual(
        TOKEN_BUDGET,
      );
      expect(rollBefore, `${npcId} resolveRoll before count`).toBeLessThanOrEqual(TOKEN_BUDGET);
    }
  });
});

// ---------------------------------------------------------------------------
// C-489: One authority path for consequences
// ---------------------------------------------------------------------------

/**
 * Installs fresh mocks on the shared relationshipService double so each test
 * starts with an empty, writable call history (the `.mock.calls` array itself
 * is readonly and cannot be reassigned).
 */
const resetRelationshipService = () => {
  relationshipService.applyDelta = mock(() => ({ trustAfter: 0, affinityAfter: 0 }));
  relationshipService.adjustFactionStanding = mock(() => ({
    factionId: '',
    standing: 0,
    tier: 'neutral',
    lastChangedAt: '',
  }));
};

/** Exercises consequence handling through the public roll-resolution path. */
const resolveConsequences = async (options: {
  deltas: NpcStateDelta[];
  npcId?: string;
  narrative?: string;
}): Promise<NpcRollResolutionOutput> => {
  const narrative = options.narrative ?? 'The outcome is decided.';
  npcDialogueService.configure({
    contentProvider: makeContentProvider(),
    textGenerator: makeStreamingTextGenerator({
      chunks: [narrative],
      structured: {
        narrativeResult: narrative,
        stateDeltas: options.deltas,
        suggestedChips: [],
      },
    }),
    executors: makeExecutors(),
  });

  return npcDialogueService.resolveRoll({
    npcId: options.npcId ?? 'village_elder',
    npcName: 'Elder Thalia',
    messages: [],
    signal: new AbortController().signal,
    checkType: 'persuasion',
    difficultyClass: 12,
    rollTotal: 18,
    outcome: 'pass',
    playerInput: 'I appeal to your honor.',
  });
};

/** Runs the production consequence authority with the matching active event. */
const runConsequence = (req: ConsequenceRequest): ConsequenceResult => {
  (
    npcDialogueService as unknown as {
      _activeConsequenceEvent: { operationId: string; sourceEventId: string } | null;
    }
  )._activeConsequenceEvent = { operationId: req.operationId, sourceEventId: req.sourceEventId };
  return (
    npcDialogueService as unknown as {
      _applyConsequences(r: ConsequenceRequest): ConsequenceResult;
    }
  )._applyConsequences(req);
};

const appliedDeltas = (result: ConsequenceResult): string[] => result.applied.map((d) => d.kind);

describe('C-489 AC-1: accepted deltas are actually applied', () => {
  beforeEach(() => {
    resetRelationshipService();
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });
  });

  test('trust_change routes through the kernel and mutates relationship state', async () => {
    const output = await resolveConsequences({
      deltas: [{ kind: 'trust_change', target: 'npc-001', value: 3 }],
    });

    expect(output.stateDeltas.map((delta) => delta.kind)).toEqual(['trust_change']);
    // The store (not a "valid" array) must have been mutated.
    const calls = (relationshipService.applyDelta as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      characterId: 'npc-001',
      trustDelta: 3,
      affinityDelta: 0,
      eventDescription: expect.stringContaining('Dialogue consequence'),
    });
  });

  test('relationship_update with label affinity maps to affinityDelta', async () => {
    const output = await resolveConsequences({
      deltas: [{ kind: 'relationship_update', target: 'npc-001', value: 5, label: 'affinity' }],
    });

    expect(output.stateDeltas.map((delta) => delta.kind)).toEqual(['relationship_update']);
    const calls = (relationshipService.applyDelta as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ characterId: 'npc-001', trustDelta: 0, affinityDelta: 5 });
  });

  test('relationship_update with label faction routes to adjustFactionStanding', async () => {
    const output = await resolveConsequences({
      deltas: [{ kind: 'relationship_update', target: 'ember_order', value: -2, label: 'faction' }],
    });

    expect(output.stateDeltas.map((delta) => delta.kind)).toEqual(['relationship_update']);
    const calls = (
      relationshipService.adjustFactionStanding as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      factionId: 'ember_order',
      delta: -2,
      reason: expect.stringContaining('Dialogue consequence'),
    });
  });
});

describe('C-489 AC-2: one authority checks entitlement, idempotency and provenance', () => {
  beforeEach(() => {
    resetRelationshipService();
    npcDialogueService.configure({
      contentProvider: makeContentProvider(), // no getItem — no pack item is grantable
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });
  });

  test('an NPC is not entitled to grant an item the pack does not define', async () => {
    const output = await resolveConsequences({
      deltas: [{ kind: 'inventory_grant', target: 'legendary_sword', value: 1 }],
    });

    expect(output.stateDeltas).toEqual([]);
    expect(output.narrativeResult).toContain('beyond what this character could grant');
  });

  test('flag_set accepts authored quest-ending labels and rejects unknown labels', async () => {
    const authored = await resolveConsequences({
      deltas: [
        {
          kind: 'flag_set',
          target: 'fading_ward',
          label: 'emberwatch.ending.renewed',
        },
      ],
    });
    const unknown = await resolveConsequences({
      deltas: [{ kind: 'flag_set', target: 'fading_ward', label: 'invented.flag' }],
    });

    expect(authored.stateDeltas).toHaveLength(1);
    expect(unknown.stateDeltas).toEqual([]);
    expect(unknown.narrativeResult).toContain('beyond what this character could grant');
  });

  test('retrying the same operationId and canonical delta key is already-granted', () => {
    const delta: NpcStateDelta = { kind: 'trust_change', target: 'npc-001', value: 2 };
    const first = runConsequence({
      operationId: 'op-retry',
      sourceEventId: 'ev-retry',
      npcId: 'village_elder',
      deltas: [delta],
    });
    expect(appliedDeltas(first)).toEqual(['trust_change']);

    const second = runConsequence({
      operationId: 'op-retry',
      sourceEventId: 'ev-retry',
      npcId: 'village_elder',
      deltas: [delta],
    });
    expect(appliedDeltas(second)).toEqual([]);
    expect(second.rejected).toHaveLength(1);
    expect(second.rejected[0].reason).toBe('already-granted');
  });

  test('an unknown sourceEventId is rejected as no-provenance', () => {
    (
      npcDialogueService as unknown as {
        _activeConsequenceEvent: { operationId: string; sourceEventId: string } | null;
      }
    )._activeConsequenceEvent = { operationId: 'op-x', sourceEventId: 'the-loaded-event' };

    const result = (
      npcDialogueService as unknown as {
        _applyConsequences(r: ConsequenceRequest): ConsequenceResult;
      }
    )._applyConsequences({
      operationId: 'op-x',
      sourceEventId: 'a-different-event',
      npcId: 'village_elder',
      deltas: [{ kind: 'trust_change', target: 'npc-001', value: 2 }],
    });

    expect(appliedDeltas(result)).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe('no-provenance');
  });

  test('a legitimate repeat under a new authoritative operation/event pair is a second grant', async () => {
    const delta: NpcStateDelta = { kind: 'trust_change', target: 'npc-001', value: 2 };
    const first = await resolveConsequences({ deltas: [delta] });
    const second = await resolveConsequences({ deltas: [delta] });

    expect(first.stateDeltas.map((applied) => applied.kind)).toEqual(['trust_change']);
    expect(second.stateDeltas.map((applied) => applied.kind)).toEqual(['trust_change']);
  });
});

describe('C-489 AC-3: state commits before narration is shown', () => {
  beforeEach(() => {
    resetRelationshipService();
  });

  test('resolveRoll mutates the store before the resolved narration is returned', async () => {
    const chunks: string[] = [];
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (opts.schema) {
        return {
          text: 'You have earned my trust.',
          structured: {
            narrativeResult: 'You have earned my trust.',
            stateDeltas: [{ kind: 'trust_change', target: 'npc-001', value: 2 }],
            suggestedChips: [],
          },
        };
      }
      (opts.onChunk as ((t: string) => void) | undefined)?.('You have earned my trust.');
      return { text: 'You have earned my trust.' };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const output = await npcDialogueService.resolveRoll({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: new AbortController().signal,
      checkType: 'persuasion',
      difficultyClass: 12,
      rollTotal: 18,
      outcome: 'pass',
      playerInput: 'I appeal to your honor.',
      onChunk: (text) => chunks.push(text),
    });

    // By the time the narration is returned (and would be appended to the
    // transcript by the caller), the store mutation has already happened.
    const calls = (relationshipService.applyDelta as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(output.stateDeltas).toHaveLength(1);
  });
});

describe('C-489 AC-4: rejection is coherent and logged', () => {
  beforeEach(() => {
    resetRelationshipService();
  });

  test('a rejected delta is reported with player-facing prose and excluded from applied', async () => {
    const output = await resolveConsequences({
      // No getItem on the stub content provider → not-entitled.
      deltas: [{ kind: 'inventory_grant', target: 'nonexistent_item', value: 1 }],
    });

    expect(output.stateDeltas).toEqual([]);
    expect(output.narrativeResult).toContain('beyond what this character could grant');
    expect(output.narrativeResult).not.toContain('not-entitled');
  });

  test('resolveRoll surfaces reconciliation text instead of a narrated success', async () => {
    const textGenerator = mock(async (opts: Record<string, unknown>) => {
      if (opts.schema) {
        return {
          text: 'Here, take the wand.',
          structured: {
            narrativeResult: 'Here, take the wand.',
            // Item not in the stub pack → rejected.
            stateDeltas: [{ kind: 'inventory_grant', target: 'ward_wand', value: 1 }],
            suggestedChips: [],
          },
        };
      }
      (opts.onChunk as ((t: string) => void) | undefined)?.('Here, take the wand.');
      return { text: 'Here, take the wand.' };
    });
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator,
      executors: makeExecutors(),
    });

    const output = await npcDialogueService.resolveRoll({
      npcId: 'village_elder',
      npcName: 'Elder Thalia',
      messages: [],
      signal: new AbortController().signal,
      checkType: 'persuasion',
      difficultyClass: 12,
      rollTotal: 18,
      outcome: 'pass',
      playerInput: 'I ask for the wand.',
    });

    expect(output.stateDeltas).toHaveLength(0);
    // Reconciliation text acknowledges the world did not change.
    expect(output.narrativeResult).toContain('did not take effect');
    expect(output.narrativeResult).toContain('beyond what this character could grant');
    expect(output.narrativeResult).not.toContain('not-entitled');
  });
});

describe('C-489 AC-6: the production relationship authority invokes the rules kernel', () => {
  beforeEach(() => {
    resetRelationshipService();
    npcDialogueService.configure({
      contentProvider: makeContentProvider(),
      textGenerator: makeTextGenerator(),
      executors: makeExecutors(),
    });
  });

  test('an out-of-range trust delta is clamped by resolveCommand before persistence', async () => {
    // value 200 is finite, so it passes validity; only the kernel's
    // applyRelationshipDelta resolver clamps to [-100, 100]. If the authority
    // forwarded the model's value verbatim, applyDelta would receive 200.
    const output = await resolveConsequences({
      deltas: [{ kind: 'trust_change', target: 'npc-001', value: 200 }],
    });

    const calls = (relationshipService.applyDelta as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls).toHaveLength(1);
    // Kernel computed trustAfter = 100 (clamped from 200); persistence gets the
    // resolved mechanical delta (100 - current 0).
    expect(calls[0][0]).toMatchObject({ characterId: 'npc-001', trustDelta: 100 });
    expect(output.stateDeltas[0]).toMatchObject({ kind: 'trust_change', value: 100 });
  });

  test('a rejected delta does not invoke the kernel or the store', async () => {
    const output = await resolveConsequences({
      npcId: 'unknown_npc',
      deltas: [{ kind: 'trust_change', target: 'npc-001', value: 2 }],
    });

    const calls = (relationshipService.applyDelta as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(calls).toHaveLength(0);
    expect(output.stateDeltas).toEqual([]);
  });
});

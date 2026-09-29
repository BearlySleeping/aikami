// biome-ignore-all lint/style/useNamingConvention: test fixture uses content pack snake_case keys
// apps/frontend/client/src/lib/services/game/__tests__/npc_dialogue_fixtures.ts
//
// Shared fixtures for the NpcDialogueService test suites. Lives under
// __tests__/ (the established home for shared client test fixtures — see
// ../__tests__/local_database_fixture.ts) so these exports are recognised as
// test-only rather than as unconsumed production capabilities.
//
// The dialogue unit tests span two files — the orchestrator itself and the
// call-2 extraction contract (issue #382) — and both need the same content-pack
// stub, executor spies, and two-call text generators. They live here so neither
// test file has to own them, and so `guard_source_file_size` can see the split
// as a real reduction rather than growth.

import { expect, mock } from 'bun:test';
import { campaignService } from '../../campaign/campaign_service.svelte.ts';
import { type NpcDialogueService, npcDialogueService } from '../npc_dialogue_service.svelte';
import { questStateService } from '../quest_state_service.svelte.ts';

/**
 * The provider/options shapes `configure` accepts, derived rather than
 * re-declared so these stubs cannot drift from the service contract.
 */
type ConfigureOptions = Parameters<NpcDialogueService['configure']>[0];
type StubContentProvider = ConfigureOptions['contentProvider'];

export const STUB_EMBERWATCH = {
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
    village_guard: {
      name: 'Bram the Guard',
      defaultDialogueKey: 'bram_greeting',
      isCompanion: true,
      companionClassId: 'fighter',
      initialApproval: 10,
      personality: {
        voice: 'Steady and plain-spoken.',
        manner: 'Alert and loyal.',
      },
      agenda: [
        'Keep the gates of Emberwatch shut against the Crimson Covenant',
        'Prove to Elder Thalia that a guard oath can hold where a relic cannot',
      ],
      knowledge: ['The ward is renewed by the people who keep watch over it'],
      boundaries: ['refuse|Threaten an innocent villager'],
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

/**
 * Executed-command spy log. Reassigned (not cleared) by {@link makeExecutors},
 * so importers must read it through this live ESM binding.
 */
export let execLog: string[] = [];

export const makeContentProvider = (
  overrides?: Partial<typeof STUB_EMBERWATCH>,
): StubContentProvider => {
  const data = { ...STUB_EMBERWATCH, ...overrides };
  return {
    getNpc: mock((npcId: string) => {
      const npc = (data.npcs as Record<string, Record<string, unknown>>)[npcId];
      // The stub is a deliberately partial content pack; `configure` wants the
      // full NPC entry shape. Cast is confined to this one boundary.
      return npc ? ({ ...npc } as ReturnType<StubContentProvider['getNpc']>) : undefined; // guard-ignore lint/type-safety/casting: partial content-pack stub
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

export const makeExecutors = (): NonNullable<ConfigureOptions['executors']> => {
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
    recruit: mock((_opts: { npcId: string; npcName: string }) => {
      execLog.push('recruit');
      return true;
    }),
    presentEvidence: mock((_opts: { npcId: string; evidenceId: string }) => {
      execLog.push('presentEvidence');
      return true;
    }),
  };
};

export const makeTextGenerator = (options?: {
  text?: string;
  structured?: unknown;
  error?: Error;
}) =>
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
 * Two-call-aware generator: call 1 (no schema) streams `chunks` via onChunk;
 * call 2 (schema) returns the structured extraction (or throws). C-401 mirrors
 * the split production glue.
 */
export const makeStreamingTextGenerator = (options?: {
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
      // Call 2 — metadata extraction. It does NOT return a narrative: call 1
      // already streamed one and the client treats it as authoritative (#382).
      if (options?.call2Error) {
        throw options.call2Error;
      }
      return { text: '', structured: options?.structured };
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
export const expectAbortRejection = async (promise: Promise<unknown>): Promise<void> => {
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    rejected = (error as Error)?.name === 'AbortError' || /abort/i.test(String(error));
  }
  expect(rejected).toBe(true);
};

/**
 * Pins the ambient state a dialogue turn resolves against: an active campaign
 * and no discoverable evidence. Shared by beforeEach/afterEach in every suite so
 * a turn cannot leak between files.
 */
export const resetDialogueServiceFixture = (): void => {
  questStateService.getDiscoverableEvidence = () => [];
  // The service resolves dialogue against the active campaign; pin a stable
  // one (individual tests may override this).
  Object.defineProperty(campaignService, 'activeCampaign', {
    value: { id: 'default-emberwatch' },
    configurable: true,
  });
  npcDialogueService.configure({
    contentProvider: makeContentProvider(),
    textGenerator: makeTextGenerator(),
    executors: makeExecutors(),
  });
};

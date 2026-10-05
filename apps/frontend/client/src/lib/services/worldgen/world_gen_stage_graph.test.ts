// apps/frontend/client/src/lib/services/worldgen/world_gen_stage_graph.test.ts
//
// G01 — stage graph tests.
//
// The graph's job is to make "what must re-run?" a decidable question. These
// tests pin that a fingerprint depends on exactly the inputs its stage reads,
// and that invalidation is transitive.

import { describe, expect, test } from 'bun:test';
import { schemaCheck, WORLD_GEN_DRAFT_LIMITS, type WorldGenDraftInput } from '@aikami/schemas';
import {
  allocateStableIds,
  invalidatedStages,
  readyStages,
  resolveQuestGiverNames,
  stageFingerprint,
  stagesInvalidatedBy,
  WORLD_GEN_STAGES,
  type WorldGenStageContext,
  worldGenStageInputs,
} from './world_gen_stage_graph.ts';
import { assembleWorldGenStagePrompt, WORLD_GEN_STAGE_SCHEMAS } from './world_gen_stage_prompts.ts';

const INPUT: WorldGenDraftInput = {
  genre: 'Fantasy',
  tone: 'Heroic',
  setting: 'A twilight valley.',
  difficulty: 'Medium',
  goals: 'Relight the wardstones.',
};

const SETTING = {
  worldName: 'Duskhollow',
  worldDescription: 'A lantern-lit frontier town.',
  themes: ['frontier'],
};

const CAST = [
  {
    id: 'npc_maren',
    name: 'Maren',
    race: 'Human',
    class: 'Innkeeper',
    role: 'Quest Giver',
    description: 'A weathered innkeeper.',
    personality: 'Sharp-tongued.',
  },
];

const context = (overrides: Partial<WorldGenStageContext> = {}): WorldGenStageContext => ({
  input: INPUT,
  setting: SETTING,
  cast: CAST,
  ...overrides,
});

describe('readyStages — G01', () => {
  test('setting alone is ready at the start of a run', () => {
    expect(readyStages(new Set(), false)).toEqual(['setting']);
  });

  test('setting unblocks cast, places and hudWidgets but not arcs', () => {
    expect(readyStages(new Set(['setting']), false)).toEqual(['cast', 'places', 'hudWidgets']);
  });

  test('arcs become ready only once the cast exists', () => {
    // With the cast done, the stages still awaiting work are the places and HUD
    // widgets (unblocked by `setting`) plus the arcs (unblocked by `cast`).
    expect(readyStages(new Set(['setting', 'cast']), false)).toEqual([
      'places',
      'hudWidgets',
      'arcs',
    ]);
    expect(readyStages(new Set(['setting']), false)).not.toContain('arcs');
  });

  test('nothing is ready after every stage completed', () => {
    const all = new Set(['setting', 'cast', 'places', 'hudWidgets', 'arcs']);
    expect(readyStages(all, false)).toEqual([]);
  });

  test('an aborted run schedules nothing', () => {
    expect(readyStages(new Set(), true)).toEqual([]);
  });
});

describe('stageFingerprint — G01', () => {
  test('is deterministic for identical context', () => {
    expect(stageFingerprint('cast', context())).toBe(stageFingerprint('cast', context()));
  });

  test("cast does not move when only the player's goals change", () => {
    const before = stageFingerprint('cast', context());
    const after = stageFingerprint(
      'cast',
      context({ input: { ...INPUT, goals: 'A different goal entirely.' } }),
    );

    expect(after).toBe(before);
  });

  test('hudWidgets DOES move when the goals change, because its prompt uses them', () => {
    const before = stageFingerprint('hudWidgets', context());
    const after = stageFingerprint(
      'hudWidgets',
      context({ input: { ...INPUT, goals: 'A different goal entirely.' } }),
    );

    expect(after).not.toBe(before);
  });

  test('arcs move when a cast member is renamed or dropped', () => {
    const before = stageFingerprint('arcs', context());
    const after = stageFingerprint(
      'arcs',
      context({
        cast: [{ ...(CAST[0] as (typeof CAST)[number]), name: 'Maren the Grey' }],
      }),
    );

    expect(after).not.toBe(before);
  });

  test('setting moves when any player answer changes', () => {
    for (const input of [
      { ...INPUT, genre: 'Horror' },
      { ...INPUT, tone: 'Grim' },
      { ...INPUT, setting: 'A drowned city.' },
      { ...INPUT, difficulty: 'Hard' },
      { ...INPUT, goals: 'Escape.' },
    ]) {
      expect(stageFingerprint('setting', context({ input }))).not.toBe(
        stageFingerprint('setting', context()),
      );
    }
  });

  test('a stage with no resolved setting fingerprints the missing value rather than crashing', () => {
    expect(() => stageFingerprint('cast', context({ setting: undefined }))).not.toThrow();
  });
});

describe('invalidatedStages — G01 checkpoint decisions', () => {
  test('a missing checkpoint invalidates that stage', () => {
    expect(invalidatedStages(new Map(), context())).toEqual([
      'setting',
      'cast',
      'places',
      'hudWidgets',
      'arcs',
    ]);
  });

  test('checkpoints recorded under the current fingerprints survive', () => {
    const checkpoints = new Map([
      ['setting', stageFingerprint('setting', context())],
      ['cast', stageFingerprint('cast', context())],
      ['places', stageFingerprint('places', context())],
      ['hudWidgets', stageFingerprint('hudWidgets', context())],
      ['arcs', stageFingerprint('arcs', context())],
    ]) as Map<string, string>;

    expect(invalidatedStages(checkpoints, context())).toEqual([]);
  });

  test('the premise, hudWidgets and arcs are invalidated when the goals change', () => {
    const checkpoints = new Map([
      ['setting', stageFingerprint('setting', context())],
      ['cast', stageFingerprint('cast', context())],
      ['places', stageFingerprint('places', context())],
      ['hudWidgets', stageFingerprint('hudWidgets', context())],
      ['arcs', stageFingerprint('arcs', context())],
    ]) as Map<string, string>;

    const changedGoals = context({ input: { ...INPUT, goals: 'Something else.' } });

    // `setting` reads the goals (the premise is built around them), as do
    // `hudWidgets` (written against them) and `arcs` (the goals become
    // chapters). `cast` and `places` read only the resolved premise, so they
    // survive a goals edit once that premise is re-derived.
    expect(invalidatedStages(checkpoints, changedGoals)).toEqual(['setting', 'hudWidgets', 'arcs']);
  });
});

describe('stagesInvalidatedBy — G01 transitive invalidation', () => {
  test('changing the setting invalidates everything downstream', () => {
    expect(stagesInvalidatedBy(new Set(['setting']))).toEqual([
      'setting',
      'cast',
      'places',
      'hudWidgets',
      'arcs',
    ]);
  });

  test('changing the cast invalidates only the arcs', () => {
    expect(stagesInvalidatedBy(new Set(['cast']))).toEqual(['cast', 'arcs']);
  });

  test('changing a leaf stage invalidates only itself', () => {
    expect(stagesInvalidatedBy(new Set(['places']))).toEqual(['places']);
  });

  test('an empty change set invalidates nothing', () => {
    expect(stagesInvalidatedBy(new Set())).toEqual([]);
  });
});

describe('allocateStableIds — G01', () => {
  test('derives a readable id from a display name', () => {
    expect(allocateStableIds('npc', ['Maren'])).toEqual(['npc_maren']);
  });

  test('gives two same-named cast members DISTINCT ids', () => {
    expect(allocateStableIds('npc', ['Maren', 'Maren', 'Maren'])).toEqual([
      'npc_maren',
      'npc_maren-2',
      'npc_maren-3',
    ]);
  });

  test('slugifies punctuation and case', () => {
    expect(allocateStableIds('place', ['The Ember Market!'])).toEqual(['place_the-ember-market']);
  });

  test('falls back for a name with no usable characters', () => {
    const ids = allocateStableIds('npc', ['???']);

    expect(ids[0]).toMatch(/^npc_[a-z0-9-]{1,48}$/);
  });
});

describe('resolveQuestGiverNames — G01', () => {
  const cast = [
    { id: 'npc_maren', name: 'Maren' },
    { id: 'npc_maren-2', name: 'Maren' },
    { id: 'npc_thorn', name: 'Thorn' },
  ];

  test('resolves a name to its cast id', () => {
    expect(resolveQuestGiverNames(['Thorn'], cast)).toEqual({
      ids: ['npc_thorn'],
      unresolved: [],
    });
  });

  test('two same-named givers resolve to two DIFFERENT ids', () => {
    const result = resolveQuestGiverNames(['Maren', 'Maren'], cast);

    expect(result.ids).toEqual(['npc_maren', 'npc_maren-2']);
    expect(result.unresolved).toEqual([]);
  });

  test('an unknown name is reported, never silently dropped', () => {
    expect(resolveQuestGiverNames(['Nobody'], cast)).toEqual({
      ids: [],
      unresolved: ['Nobody'],
    });
  });

  test('a third reference to a two-member name is reported rather than aliased', () => {
    const result = resolveQuestGiverNames(['Maren', 'Maren', 'Maren'], cast);

    expect(result.unresolved).toEqual(['Maren']);
  });

  test('matching is case-insensitive', () => {
    expect(resolveQuestGiverNames(['  thorn '], cast).ids).toEqual(['npc_thorn']);
  });
});
// ---------------------------------------------------------------------------
// Boundedness + the prompt/fingerprint agreement
//
// These are the properties that make the checkpoint decision TRUSTWORTHY. The
// earlier implementation joined raw text into the fingerprint, which produced
// strings far past the 128-character schema bound the draft persists them
// under, and embedded the whole wizard form in every stage prompt while the
// fingerprints were hand-written per stage — so the two disagreed about what a
// stage had actually read.
// ---------------------------------------------------------------------------

describe('stageFingerprint — bounded and canonical (G01)', () => {
  test('fits the 128-character checkpoint schema for a MAXIMUM-size premise', () => {
    const worst = context({
      input: {
        genre: 'Fantasy',
        tone: 'Heroic',
        setting: 'x'.repeat(2000),
        difficulty: 'Medium',
        goals: 'y'.repeat(2000),
      },
      setting: {
        worldName: 'n'.repeat(120),
        worldDescription: 'd'.repeat(4000),
        themes: Array.from({ length: 8 }, (_, index) => `t${index}${'z'.repeat(119)}`),
      },
      cast: Array.from({ length: 20 }, (_, index) => ({
        id: `npc_${index}`,
        name: `Npc ${index}`,
        race: 'Human',
        class: 'Innkeeper',
        role: 'Quest Giver',
        description: 'a'.repeat(2000),
        personality: 'b'.repeat(2000),
      })),
    });

    for (const stage of WORLD_GEN_STAGES) {
      const fingerprint = stageFingerprint(stage, worst);
      expect(fingerprint.length).toBeGreaterThan(0);
      // The persisted checkpoint schema caps this at 128. A raw joined text
      // fingerprint is thousands of characters long here and would fail the
      // draft's own schema on the way to disk.
      expect(fingerprint.length).toBeLessThanOrEqual(128);
    }
  });

  test('a delimiter collision cannot produce the same fingerprint', () => {
    // The classic failure: joining the parts with a bare separator makes
    // ['ab', 'c'] and ['a', 'bc'] hash identically, so a checkpoint recorded
    // against one premise would be accepted for a different one. The framing
    // in `fingerprintInput` is what makes these differ.
    const left = context({ setting: { ...SETTING, themes: ['ab', 'c'] } });
    const right = context({ setting: { ...SETTING, themes: ['a', 'bc'] } });

    // `cast` and `places` are the stages that read the premise's themes.
    expect(stageFingerprint('cast', left)).not.toBe(stageFingerprint('cast', right));
    expect(stageFingerprint('places', left)).not.toBe(stageFingerprint('places', right));
  });

  test('a field-boundary shift inside a SINGLE string is still a change', () => {
    const left = context({ input: { ...INPUT, goals: 'ab' } });
    const right = context({ input: { ...INPUT, goals: 'a b' } });

    expect(stageFingerprint('hudWidgets', left)).not.toBe(stageFingerprint('hudWidgets', right));
    expect(stageFingerprint('arcs', left)).not.toBe(stageFingerprint('arcs', right));
  });

  test('is stable across a key-order difference in the same logical context', () => {
    const a = context({ input: { ...INPUT } });
    const b = context({
      input: {
        goals: INPUT.goals,
        difficulty: INPUT.difficulty,
        setting: INPUT.setting,
        tone: INPUT.tone,
        genre: INPUT.genre,
      },
    });

    for (const stage of WORLD_GEN_STAGES) {
      expect(stageFingerprint(stage, a)).toBe(stageFingerprint(stage, b));
    }
  });

  test('every stage is distinguishable from every other', () => {
    const fingerprints = new Set(
      WORLD_GEN_STAGES.map((stage) => stageFingerprint(stage, context())),
    );
    expect(fingerprints.size).toBe(WORLD_GEN_STAGES.length);
  });
});

describe('prompt scope and fingerprint scope agree (G01)', () => {
  test('the cast prompt does not carry the goals, so the fingerprint need not see them', () => {
    const prompt = assembleWorldGenStagePrompt('cast', context());
    const withOtherGoals = assembleWorldGenStagePrompt(
      'cast',
      context({ input: { ...INPUT, goals: 'A completely different ambition.' } }),
    );

    // This is the pairing that matters. If the prompt carried the goals, a
    // goals edit would change what the provider was asked, and a fingerprint
    // that ignored them would silently reuse a cast built for the old ask.
    // Prompt and fingerprint must move TOGETHER, and here both stay still.
    expect(prompt).not.toContain('Relight the wardstones.');
    expect(prompt).not.toContain('A completely different ambition.');
    expect(prompt).toContain('Duskhollow');
    expect(withOtherGoals).toBe(prompt);
    expect(stageFingerprint('cast', context({ input: { ...INPUT, goals: 'Other.' } }))).toBe(
      stageFingerprint('cast', context()),
    );
  });

  test('the hudWidgets prompt carries the goals AND the tone, and nothing it does not read', () => {
    const prompt = assembleWorldGenStagePrompt('hudWidgets', context());

    expect(prompt).toContain('Relight the wardstones.');
    expect(prompt).toContain('Heroic');
    // `setting` and `difficulty` are NOT in this stage's slice, so the prompt
    // must not carry them — carrying them would over-invalidate on every edit
    // and cost a provider call for a stage whose inputs did not move.
    expect(prompt).not.toContain('A twilight valley.');
    expect(prompt).not.toContain('Medium');
  });

  test('the arcs prompt carries the goals and the cast roster', () => {
    const prompt = assembleWorldGenStagePrompt('arcs', context());

    expect(prompt).toContain('Relight the wardstones.');
    expect(prompt).toContain('Maren');
    expect(prompt).toContain('npc_maren');
    expect(prompt).not.toContain('A twilight valley.');
  });

  test('the setting prompt carries every answer, because the premise is built from all of them', () => {
    const prompt = assembleWorldGenStagePrompt('setting', context());

    for (const answer of Object.values(INPUT)) {
      expect(prompt).toContain(answer);
    }
  });

  test('changing an input OUT of a stage scope leaves both its prompt and fingerprint alone', () => {
    // Exhaustive over the table rather than spot-checked: this is the property
    // that keeps checkpoint reuse honest, and a table that grows a stage with
    // the wrong scope should fail here rather than in a provider bill.
    for (const stage of WORLD_GEN_STAGES) {
      // The scope is read back through the SAME accessor production uses, so
      // this test cannot pass against a table the code no longer honours.
      const inScope = new Set(Object.keys(worldGenStageInputs(stage, context()).input));
      for (const key of Object.keys(INPUT) as (keyof typeof INPUT)[]) {
        if (inScope.has(key)) {
          continue;
        }
        const moved = context({ input: { ...INPUT, [key]: `MOVED-${key}` } });
        expect(stageFingerprint(stage, moved)).toBe(stageFingerprint(stage, context()));
        expect(assembleWorldGenStagePrompt(stage, moved)).toBe(
          assembleWorldGenStagePrompt(stage, context()),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Stage schemas are a checkpoint gate
//
// `absorbStageResult` records a checkpoint only after the payload passes
// `WORLD_GEN_STAGE_SCHEMAS[stage]`, and a checkpoint that later fails the
// whole-draft parse throws away every stage's work. So a stage schema must
// refuse exactly what the final `WorldGenDraft*Schema` refuses — no more, so
// legitimate payloads are not retried forever, and no less, so an unbuildable
// draft never holds a checkpoint.
// ---------------------------------------------------------------------------

describe('WORLD_GEN_STAGE_SCHEMAS — checkpoint gate (G01)', () => {
  const validArcs = (objectives: string[]): unknown => ({
    arcs: [
      {
        chapter: 'Chapter 1',
        description: 'The ward fades.',
        objectives,
        questGiverNames: ['Maren'],
      },
    ],
  });

  test('an arc with no objectives is refused, because the draft requires one', () => {
    expect(schemaCheck(WORLD_GEN_STAGE_SCHEMAS.arcs, validArcs(['Find the wardstone']))).toBe(true);
    expect(schemaCheck(WORLD_GEN_STAGE_SCHEMAS.arcs, validArcs([]))).toBe(false);
  });

  test('a blank objective string is refused, because the draft requires minLength 1', () => {
    expect(schemaCheck(WORLD_GEN_STAGE_SCHEMAS.arcs, validArcs(['', 'Return to Maren']))).toBe(
      false,
    );
  });

  test('repeated objectives are allowed — the draft has no uniqueness rule for them', () => {
    expect(
      schemaCheck(
        WORLD_GEN_STAGE_SCHEMAS.arcs,
        validArcs(['Relight the ward', 'Relight the ward']),
      ),
    ).toBe(true);
  });

  test('a blank theme string is refused, because the draft requires minLength 1', () => {
    const base = {
      worldName: 'Duskhollow',
      worldDescription: 'A lantern-lit frontier town.',
      themes: ['frontier'],
    };

    expect(schemaCheck(WORLD_GEN_STAGE_SCHEMAS.setting, base)).toBe(true);
    expect(
      schemaCheck(WORLD_GEN_STAGE_SCHEMAS.setting, { ...base, themes: ['frontier', ''] }),
    ).toBe(false);
  });

  test('a blank quest-giver name is refused rather than resolving to nothing', () => {
    const blank = {
      arcs: [
        {
          chapter: 'Chapter 1',
          description: 'The ward fades.',
          objectives: ['Find the wardstone'],
          questGiverNames: [''],
        },
      ],
    };

    expect(schemaCheck(WORLD_GEN_STAGE_SCHEMAS.arcs, blank)).toBe(false);
  });

  test('the count ceilings match the draft limits the schema re-asserts', () => {
    const manyArcs = {
      arcs: Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxArcs + 1 }, (_, index) => ({
        chapter: `Chapter ${index}`,
        description: 'Something happens.',
        objectives: ['Do the thing'],
        questGiverNames: [],
      })),
    };

    expect(schemaCheck(WORLD_GEN_STAGE_SCHEMAS.arcs, manyArcs)).toBe(false);
    expect(
      schemaCheck(WORLD_GEN_STAGE_SCHEMAS.setting, {
        worldName: 'Duskhollow',
        worldDescription: 'A lantern-lit frontier town.',
        themes: Array.from(
          { length: WORLD_GEN_DRAFT_LIMITS.maxThemes + 1 },
          (_, index) => `theme-${index}`,
        ),
      }),
    ).toBe(false);
  });
});

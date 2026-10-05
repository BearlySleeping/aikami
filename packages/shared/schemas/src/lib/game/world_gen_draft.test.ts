// packages/shared/schemas/src/lib/game/world_gen_draft.test.ts
//
// G01 — WorldGenDraft schema + validation tests.
//
// The negative controls here matter more than the happy path: a draft that
// silently accepts a duplicate id, a dangling reference, or an oversized body
// is exactly the incoherence this milestone exists to prevent.

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  parseWorldGenDraft,
  validateWorldGenDraft,
  WORLD_GEN_DRAFT_LIMITS,
  type WorldGenDraft,
  WorldGenDraftSchema,
  worldGenDraftByteLength,
} from './world_gen_draft.ts';

const npcFixture = (): WorldGenDraft['cast'][number] => ({
  id: 'npc_maren',
  name: 'Maren',
  race: 'Human',
  class: 'Innkeeper',
  role: 'Quest Giver',
  description: 'A weathered innkeeper.',
  personality: 'Sharp-tongued.',
});

const draftFixture = (overrides: Partial<WorldGenDraft> = {}): WorldGenDraft => ({
  schemaVersion: 1,
  draftId: 'draft-1',
  runId: 'run-1',
  revision: 0,
  status: 'complete',
  preview: true,
  playable: false,
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z',
  input: {
    genre: 'Fantasy',
    tone: 'Heroic',
    setting: 'A twilight valley.',
    difficulty: 'Medium',
    goals: 'Relight the wardstones.',
  },
  setting: {
    worldName: 'Duskhollow',
    worldDescription: 'A lantern-lit frontier town in a twilight valley.',
    themes: ['frontier'],
  },
  cast: [
    {
      id: 'npc_maren',
      name: 'Maren',
      race: 'Human',
      class: 'Innkeeper',
      role: 'Quest Giver',
      description: 'A weathered innkeeper.',
      personality: 'Sharp-tongued.',
    },
    {
      id: 'npc_thorn',
      name: 'Thorn',
      race: 'Elf',
      class: 'Ranger',
      role: 'Ally',
      description: 'A quiet ranger.',
      personality: 'Terse.',
    },
  ],
  places: [
    {
      id: 'place_market',
      name: 'The Ember Market',
      description: 'Warm bread.',
      npcIds: ['npc_maren'],
    },
  ],
  arcs: [
    {
      id: 'arc_1',
      chapter: 'Chapter 1',
      description: 'The ward fades.',
      objectives: ['Find the wardstone'],
      questGiverIds: ['npc_maren'],
    },
  ],
  hudWidgets: [
    {
      id: 'hud_0-compass',
      slot: 'top-left',
      label: 'Compass',
      icon: 'compass',
      defaultVisibility: true,
    },
  ],
  checkpoints: [{ stage: 'setting', fingerprint: 'abc', completedAt: '2026-10-04T10:00:00.000Z' }],
  ...overrides,
});

describe('WorldGenDraftSchema — G01', () => {
  test('accepts a coherent draft', () => {
    expect(Value.Check(WorldGenDraftSchema, draftFixture())).toBe(true);
  });

  describe('preview/playable are literal invariants', () => {
    test('a draft claiming playable is rejected by the schema', () => {
      const draft = { ...draftFixture(), playable: true } as unknown;
      expect(Value.Check(WorldGenDraftSchema, draft)).toBe(false);
    });

    test('a draft claiming not-preview is rejected by the schema', () => {
      const draft = { ...draftFixture(), preview: false } as unknown;
      expect(Value.Check(WorldGenDraftSchema, draft)).toBe(false);
    });
  });

  describe('structural bounds', () => {
    test('rejects more cast members than the limit', () => {
      const cast = Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxNpcs + 1 }, (_, index) => ({
        id: `npc_${index}`,
        name: `Npc ${index}`,
        race: 'Human',
        class: 'Ranger',
        role: 'Ally',
        description: 'Someone.',
        personality: 'Quiet.',
      }));
      expect(Value.Check(WorldGenDraftSchema, draftFixture({ cast }))).toBe(false);
    });

    test('rejects more arcs than the limit', () => {
      const arcs = Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxArcs + 1 }, (_, index) => ({
        id: `arc_${index}`,
        chapter: `Chapter ${index}`,
        description: 'Something happens.',
        objectives: ['Do the thing'],
        questGiverIds: [],
      }));
      expect(Value.Check(WorldGenDraftSchema, draftFixture({ arcs }))).toBe(false);
    });

    test('rejects an id that does not match the stable-id pattern', () => {
      const broken = draftFixture({
        cast: [{ ...npcFixture(), id: 'Maren!' }],
      });

      expect(Value.Check(WorldGenDraftSchema, broken)).toBe(false);
    });

    test('rejects unknown properties', () => {
      const broken = { ...draftFixture(), compiledPack: { maps: [] } } as unknown;
      expect(Value.Check(WorldGenDraftSchema, broken)).toBe(false);
    });
  });
});

describe('validateWorldGenDraft — G01 coherence rules', () => {
  test('a coherent draft produces no diagnostics', () => {
    expect(validateWorldGenDraft(draftFixture())).toEqual([]);
  });

  test('reports a missing world setting', () => {
    const diagnostics = validateWorldGenDraft(draftFixture({ setting: undefined }));

    expect(diagnostics.map((entry) => entry.code)).toContain('missing_setting');
  });

  describe('duplicate ids', () => {
    test('two cast members sharing an id is a named duplicate_id diagnostic', () => {
      const base = draftFixture();
      const broken = draftFixture({
        cast: [
          base.cast[0] as WorldGenDraft['cast'][number],
          { ...(base.cast[1] as WorldGenDraft['cast'][number]), id: 'npc_maren' },
        ],
      });

      const diagnostics = validateWorldGenDraft(broken);

      expect(diagnostics.some((entry) => entry.code === 'duplicate_id')).toBe(true);
      expect(diagnostics.some((entry) => entry.path === 'cast[1].id')).toBe(true);
    });

    test('an id reused across collections is still a collision', () => {
      const base = draftFixture();
      const broken = draftFixture({
        places: [{ ...(base.places[0] as WorldGenDraft['places'][number]), id: 'npc_maren' }],
      });

      expect(validateWorldGenDraft(broken).some((entry) => entry.code === 'duplicate_id')).toBe(
        true,
      );
    });
  });

  describe('duplicate names', () => {
    test('two cast members sharing a name are flagged, because consumers use names', () => {
      const base = draftFixture();
      const broken = draftFixture({
        cast: [
          base.cast[0] as WorldGenDraft['cast'][number],
          { ...(base.cast[1] as WorldGenDraft['cast'][number]), name: 'Maren' },
        ],
      });

      const diagnostics = validateWorldGenDraft(broken);

      expect(diagnostics.some((entry) => entry.code === 'duplicate_name')).toBe(true);
    });

    test('distinct ids with distinct names are clean', () => {
      // Behavioural, not a restatement of "a coherent draft has no
      // diagnostics": the SAME pair of cast members that produced
      // `duplicate_id` and `duplicate_name` above is clean once it is given a
      // distinct id AND a distinct name. The defect is the collision, not the
      // cast.
      const base = draftFixture();
      const fixed = draftFixture({
        cast: [
          base.cast[0] as WorldGenDraft['cast'][number],
          { ...(base.cast[1] as WorldGenDraft['cast'][number]), id: 'npc_second', name: 'Bryn' },
        ],
      });

      expect(validateWorldGenDraft(fixed)).toEqual([]);
    });
  });

  describe('dangling references', () => {
    test('an arc pointing at a missing cast member is named exactly', () => {
      const base = draftFixture();
      const broken = draftFixture({
        arcs: [
          {
            ...(base.arcs[0] as WorldGenDraft['arcs'][number]),
            questGiverIds: ['npc_ghost'],
          },
        ],
      });

      const diagnostics = validateWorldGenDraft(broken);

      expect(diagnostics).toContainEqual({
        path: 'arcs[0].questGiverIds[0]',
        code: 'dangling_reference',
        message: 'Reference "npc_ghost" does not resolve to a cast member.',
      });
    });

    test('a place listing an unknown inhabitant is flagged', () => {
      const base = draftFixture();
      const broken = draftFixture({
        places: [{ ...(base.places[0] as WorldGenDraft['places'][number]), npcIds: ['npc_ghost'] }],
      });

      expect(
        validateWorldGenDraft(broken).some(
          (entry) => entry.code === 'dangling_reference' && entry.path === 'places[0].npcIds[0]',
        ),
      ).toBe(true);
    });
  });

  describe('size limit', () => {
    test('a draft past the byte ceiling is rejected with its real size', () => {
      const oversized = draftFixture({
        setting: {
          worldName: 'Duskhollow',
          worldDescription: 'x'.repeat(WORLD_GEN_DRAFT_LIMITS.maxBytes + 1),
          themes: [],
        },
      });

      const diagnostics = validateWorldGenDraft(oversized);

      expect(diagnostics).toContainEqual({
        path: '',
        code: 'size_limit',
        message: `Draft is ${new TextEncoder().encode(JSON.stringify(oversized)).length} bytes; the limit is ${WORLD_GEN_DRAFT_LIMITS.maxBytes} bytes.`,
      });
    });

    test('a draft just under the ceiling is NOT reported as oversized', () => {
      // The other half of the boundary: without it, a validator that reported
      // `size_limit` unconditionally would pass the test above.
      const draft = draftFixture();

      expect(worldGenDraftByteLength(draft)).toBeLessThanOrEqual(WORLD_GEN_DRAFT_LIMITS.maxBytes);
      expect(validateWorldGenDraft(draft).some((entry) => entry.code === 'size_limit')).toBe(false);
    });
  });

  test('count limits are re-asserted even when the schema is bypassed', () => {
    const tooManyHud = draftFixture({
      hudWidgets: Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxHudWidgets + 1 }, (_, index) => ({
        id: `hud_${index}`,
        slot: 'top-left',
        label: `Widget ${index}`,
        icon: 'star',
        defaultVisibility: true,
      })),
    });

    expect(validateWorldGenDraft(tooManyHud).some((entry) => entry.code === 'count_limit')).toBe(
      true,
    );
  });

  test('a count within the limit is not reported as over-count', () => {
    const atLimit = draftFixture({
      hudWidgets: Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxHudWidgets }, (_, index) => ({
        id: `hud_${index}`,
        slot: 'top-left',
        label: `Widget ${index}`,
        icon: 'star',
        defaultVisibility: true,
      })),
    });

    expect(validateWorldGenDraft(atLimit).some((entry) => entry.code === 'count_limit')).toBe(
      false,
    );
  });
});
// ---------------------------------------------------------------------------
// parseWorldGenDraft — the only sanctioned way to trust persisted JSON
// ---------------------------------------------------------------------------

describe('parseWorldGenDraft — G01', () => {
  test('accepts a structurally valid, coherent draft', () => {
    const result = parseWorldGenDraft(draftFixture());
    expect(result.ok).toBe(true);
  });

  test('refuses a non-object outright rather than guessing at its fields', () => {
    for (const raw of [null, undefined, 42, 'a draft', [], true]) {
      expect(parseWorldGenDraft(raw).ok).toBe(false);
    }
  });

  test('names the failing JSON path instead of returning a bare false', () => {
    const result = parseWorldGenDraft({ ...draftFixture(), revision: 'one' });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain('/revision');
    expect(result.reason).toContain('type');
  });

  test('refuses `playable: true` — the literal type is the invariant', () => {
    const result = parseWorldGenDraft({ ...draftFixture(), playable: true });
    expect(result.ok).toBe(false);
  });

  test('refuses a structurally VALID but incoherent draft (dangling reference)', () => {
    // Cross-references are exactly what the TypeBox schema cannot express, so
    // this is the case that `Value.Check` alone would wave through.
    const incoherent = draftFixture({
      arcs: [
        {
          id: 'arc_1',
          chapter: 'Chapter 1',
          description: 'Maren asks for help.',
          objectives: ['Find the wardstone'],
          questGiverIds: ['npc_nobody'],
        },
      ],
    });
    expect(Value.Check(WorldGenDraftSchema, incoherent)).toBe(true);

    const result = parseWorldGenDraft(incoherent);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain('questGiverIds');
  });

  test('refuses an oversized draft and reports the byte count, not the char count', () => {
    // Every field stays inside its own schema bound, so the ONLY thing this
    // draft violates is total size. The multi-byte text is the point: a
    // `String.length` check would call this ~150 KB and let it through, while
    // the UTF-8 measurement the repository actually uses calls it ~300 KB.
    const huge = draftFixture({
      // Keeps the fixture's own `npc_maren` so the ONLY remaining complaint is
      // total size.
      cast: [
        npcFixture(),
        ...Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxNpcs - 1 }, (_, index) => ({
          ...npcFixture(),
          id: `npc_filler-${index}`,
          name: `Filler ${index}`,
          description: 'ü'.repeat(2000),
          personality: 'ü'.repeat(2000),
        })),
      ],
      places: Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxPlaces }, (_, index) => ({
        id: `place_filler-${index}`,
        name: `Place ${index}`,
        description: 'ü'.repeat(2000),
        npcIds: [],
      })),
      arcs: Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxArcs }, (_, index) => ({
        id: `arc_filler-${index}`,
        chapter: `Chapter ${index}`,
        description: 'ü'.repeat(2000),
        objectives: Array.from({ length: WORLD_GEN_DRAFT_LIMITS.maxObjectivesPerArc }, () =>
          'ü'.repeat(400),
        ),
        questGiverIds: ['npc_maren'],
      })),
    });
    // Sanity: the fixture really is over the ceiling by UTF-8 bytes.
    expect(worldGenDraftByteLength(huge)).toBeGreaterThan(WORLD_GEN_DRAFT_LIMITS.maxBytes);
    expect(JSON.stringify(huge).length).toBeLessThan(WORLD_GEN_DRAFT_LIMITS.maxBytes);

    const result = parseWorldGenDraft(huge);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain('size');
  });
});

describe('worldGenDraftByteLength — G01', () => {
  test('counts UTF-8 bytes, not UTF-16 code units', () => {
    // The whole reason the helper exists: `String.length` understates
    // multi-byte text by up to 3x, so a "bounded" draft written with it
    // overflows its column exactly when the text is non-Latin.
    const draft = draftFixture({
      setting: {
        worldName: 'Duskhollow',
        worldDescription: '🌍'.repeat(10),
        themes: [],
      },
    });
    const serialized = JSON.stringify(draft);
    expect(worldGenDraftByteLength(draft)).toBeGreaterThan(serialized.length);
    expect(worldGenDraftByteLength(draft)).toBe(new TextEncoder().encode(serialized).length);
  });
});

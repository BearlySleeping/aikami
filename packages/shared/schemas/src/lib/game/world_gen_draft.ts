// packages/shared/schemas/src/lib/game/world_gen_draft.ts
//
// G01 — the private narrative-world DRAFT.
//
// A draft is what the world-generation wizard produces today: a bounded,
// internally-consistent *narrative* description of a world. It is NOT a
// playable content pack, and this module refuses to pretend otherwise:
//
//   * `preview` is the literal `true` and `playable` the literal `false`,
//     so a value that claims otherwise cannot even type-check.
//   * There are no map, grid, terrain, footprint, spawn-anchor or
//     content-pack fields, because no compiler exists to produce them yet.
//     Inventing them would be speculative scaffolding, not a draft.
//
// Coherence rules the draft actually enforces:
//   * Cast members, places, arcs and HUD widgets carry STABLE ids. Arcs
//     reference quest-givers by id, never by display name, so two NPCs
//     called "Maren" remain distinguishable and a rename cannot silently
//     repoint a quest.
//   * Every reference must resolve. A dangling reference is a named
//     diagnostic, not a silent drop.
//   * Everything is bounded (see {@link WORLD_GEN_DRAFT_LIMITS}) — counts,
//     string lengths, and the serialized size of the whole draft.
//
// Contract: G01 — safe private narrative-world drafts

import type { Static } from 'typebox';
import Type from 'typebox';
import { Value } from 'typebox/value';

// ---------------------------------------------------------------------------
// Versioning + bounds
// ---------------------------------------------------------------------------

/**
 * Stamped into every persisted draft row so an older client can migrate or
 * discard rather than mis-read a newer shape.
 */
export const WORLD_GEN_DRAFT_SCHEMA_VERSION = 1;

/**
 * Hard bounds for a single draft.
 *
 * The counts are ceilings on what one generation run may produce, enforced by
 * the TypeBox schemas below (so a provider that ignores instructions cannot
 * return 900 NPCs) and re-asserted by {@link validateWorldGenDraft} (so a
 * schema that is merely advisory downstream still cannot smuggle an
 * oversized draft through).
 */
export const WORLD_GEN_DRAFT_LIMITS = {
  maxNpcs: 20,
  maxPlaces: 12,
  maxArcs: 8,
  maxHudWidgets: 8,
  maxObjectivesPerArc: 8,
  maxQuestGiversPerArc: 4,
  maxThemes: 8,
  maxStages: 5,
  /** 256 KiB — the serialized blueprint ceiling. */
  maxBytes: 262_144,
} as const;

// ---------------------------------------------------------------------------
// Generation stages
// ---------------------------------------------------------------------------

/**
 * The dependency-ordered generation stages.
 *
 * `setting` establishes the shared world constraints; `cast`, `places` and
 * `hudWidgets` consume it and are mutually independent; `arcs` consumes the
 * cast because an arc's quest-givers must resolve to real NPC ids.
 */
export const WorldGenDraftStageSchema = Type.Union([
  Type.Literal('setting'),
  Type.Literal('cast'),
  Type.Literal('places'),
  Type.Literal('hudWidgets'),
  Type.Literal('arcs'),
]);

export type WorldGenDraftStage = Static<typeof WorldGenDraftStageSchema>;

// ---------------------------------------------------------------------------
// Draft input
// ---------------------------------------------------------------------------

/** The user's wizard answers — the only input a draft is a function of. */
export const WorldGenDraftInputSchema = Type.Object(
  {
    genre: Type.String({ minLength: 1, maxLength: 64 }),
    tone: Type.String({ minLength: 1, maxLength: 64 }),
    setting: Type.String({ minLength: 1, maxLength: 2000 }),
    difficulty: Type.String({ minLength: 1, maxLength: 32 }),
    goals: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
);

export type WorldGenDraftInput = Static<typeof WorldGenDraftInputSchema>;

// ---------------------------------------------------------------------------
// Blueprint pieces
// ---------------------------------------------------------------------------

/** The shared world premise. Stage `setting`. */
export const WorldGenDraftSettingSchema = Type.Object(
  {
    worldName: Type.String({ minLength: 1, maxLength: 120 }),
    worldDescription: Type.String({ minLength: 10, maxLength: 4000 }),
    themes: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxThemes,
    }),
  },
  { additionalProperties: false },
);

export type WorldGenDraftSetting = Static<typeof WorldGenDraftSettingSchema>;

/** Stable-id pattern shared by every generated entity. */
const STABLE_ID_PATTERN = '^[a-z]+_[a-z0-9-]{1,48}$';

/** A generated NPC. `id` is stable; `name` is display text and may collide. */
export const WorldGenDraftNpcSchema = Type.Object(
  {
    id: Type.String({ pattern: STABLE_ID_PATTERN, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    race: Type.String({ minLength: 1, maxLength: 120 }),
    class: Type.String({ minLength: 1, maxLength: 120 }),
    role: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 2000 }),
    personality: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
);

export type WorldGenDraftNpc = Static<typeof WorldGenDraftNpcSchema>;

/** A narrative place. Narrative only — no grid, terrain or footprint. */
export const WorldGenDraftPlaceSchema = Type.Object(
  {
    id: Type.String({ pattern: STABLE_ID_PATTERN, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 2000 }),
    /** NPC ids present here. Must resolve against `cast`. */
    npcIds: Type.Array(Type.String({ pattern: STABLE_ID_PATTERN, maxLength: 64 }), {
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxNpcs,
    }),
  },
  { additionalProperties: false },
);

export type WorldGenDraftPlace = Static<typeof WorldGenDraftPlaceSchema>;

/** A story arc. Quest-givers resolve by id, never by name. */
export const WorldGenDraftArcSchema = Type.Object(
  {
    id: Type.String({ pattern: STABLE_ID_PATTERN, maxLength: 64 }),
    chapter: Type.String({ minLength: 1, maxLength: 160 }),
    description: Type.String({ minLength: 1, maxLength: 2000 }),
    objectives: Type.Array(Type.String({ minLength: 1, maxLength: 400 }), {
      minItems: 1,
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxObjectivesPerArc,
    }),
    questGiverIds: Type.Array(Type.String({ pattern: STABLE_ID_PATTERN, maxLength: 64 }), {
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxQuestGiversPerArc,
    }),
  },
  { additionalProperties: false },
);

export type WorldGenDraftArc = Static<typeof WorldGenDraftArcSchema>;

/** A HUD widget blueprint — presentation intent only, never applied. */
export const WorldGenDraftHudWidgetSchema = Type.Object(
  {
    id: Type.String({ pattern: STABLE_ID_PATTERN, maxLength: 64 }),
    slot: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 120 }),
    icon: Type.String({ minLength: 1, maxLength: 120 }),
    defaultVisibility: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type WorldGenDraftHudWidget = Static<typeof WorldGenDraftHudWidgetSchema>;

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/**
 * Proof that a stage produced a result that is still valid.
 *
 * `fingerprint` is derived from exactly the inputs that stage depends on. A
 * retry re-runs only the stages whose checkpoint is missing or whose
 * fingerprint no longer matches — a successful stage is never re-issued just
 * because a sibling failed.
 */
export const WorldGenDraftCheckpointSchema = Type.Object(
  {
    stage: WorldGenDraftStageSchema,
    fingerprint: Type.String({ minLength: 1, maxLength: 128 }),
    completedAt: Type.String({ minLength: 1, maxLength: 40 }),
  },
  { additionalProperties: false },
);

export type WorldGenDraftCheckpoint = Static<typeof WorldGenDraftCheckpointSchema>;

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

/** Persisted lifecycle of a private draft row. */
export const WorldGenDraftStatusSchema = Type.Union([
  Type.Literal('in_progress'),
  Type.Literal('complete'),
  Type.Literal('accepted_preview'),
  Type.Literal('failed'),
]);

export type WorldGenDraftStatus = Static<typeof WorldGenDraftStatusSchema>;

/**
 * A private narrative-world draft.
 *
 * `preview: true` / `playable: false` are literal types, not booleans: a
 * component that tried to render this as a playable pack would fail to
 * compile. Nothing here is a content pack, a map, or a campaign.
 */
export const WorldGenDraftSchema = Type.Object(
  {
    schemaVersion: Type.Integer({ minimum: 1, maximum: WORLD_GEN_DRAFT_SCHEMA_VERSION }),
    draftId: Type.String({ minLength: 1, maxLength: 64 }),
    /** The run that last produced a change to this draft. */
    runId: Type.String({ minLength: 1, maxLength: 64 }),
    /** Bumped whenever inputs change; a stale run may not write. */
    revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    status: WorldGenDraftStatusSchema,
    preview: Type.Literal(true),
    playable: Type.Literal(false),
    createdAt: Type.String({ minLength: 1, maxLength: 40 }),
    updatedAt: Type.String({ minLength: 1, maxLength: 40 }),
    input: WorldGenDraftInputSchema,
    setting: Type.Optional(WorldGenDraftSettingSchema),
    cast: Type.Array(WorldGenDraftNpcSchema, {
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxNpcs,
    }),
    places: Type.Array(WorldGenDraftPlaceSchema, {
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxPlaces,
    }),
    arcs: Type.Array(WorldGenDraftArcSchema, { maxItems: WORLD_GEN_DRAFT_LIMITS.maxArcs }),
    hudWidgets: Type.Array(WorldGenDraftHudWidgetSchema, {
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxHudWidgets,
    }),
    checkpoints: Type.Array(WorldGenDraftCheckpointSchema, {
      maxItems: WORLD_GEN_DRAFT_LIMITS.maxStages,
    }),
  },
  { additionalProperties: false },
);

export type WorldGenDraft = Static<typeof WorldGenDraftSchema>;

// ---------------------------------------------------------------------------
// Parsing persisted drafts
// ---------------------------------------------------------------------------

/** Outcome of {@link parseWorldGenDraft}. */
export type WorldGenDraftParseResult =
  | { ok: true; draft: WorldGenDraft }
  | { ok: false; reason: string };

/**
 * The ONLY way a persisted draft may become a {@link WorldGenDraft}.
 *
 * Every durability boundary — the device repository, the reload path, the
 * hydration path — goes through here, because `JSON.parse(x) as WorldGenDraft`
 * is a claim about `x` that nothing checks. A truncated row, a hand-edited
 * row, a blueprint written by a newer client, or a column that was silently
 * coerced all reach a type cast here and detonate somewhere else, as a
 * `undefined is not an object` deep inside a prompt assembly.
 *
 * Three gates, all of which must pass:
 *
 *   1. STRUCTURE — `WorldGenDraftSchema`, so a field that is missing, of the
 *      wrong type, over a bound, or unexpected is rejected with its JSON path.
 *   2. CROSS-REFERENCE — {@link validateWorldGenDraft}, because the structural
 *      schema cannot express "this arc's quest giver exists".
 *   3. SIZE — the UTF-8 byte ceiling, measured the same way on both sides of
 *      the boundary so a row cannot pass read-side bounds and fail write-side.
 *
 * @returns The validated draft, or a human-readable reason it was refused.
 */
export const parseWorldGenDraft = (raw: unknown): WorldGenDraftParseResult => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'Draft payload is not a JSON object.' };
  }
  if (!Value.Check(WorldGenDraftSchema, raw)) {
    // TypeBox's union of error shapes does not expose `instancePath`/`keyword`
    // on every member, so the readable hint is built defensively rather than
    // asserted. The JSON pointer is what makes the message actionable: it is
    // the path a maintainer needs to look at in the offending column.
    const errors = [...Value.Errors(WorldGenDraftSchema, raw)] as ReadonlyArray<{
      instancePath?: string;
      keyword?: string;
    }>;
    const first = errors[0];
    const where = first?.instancePath || 'draft';
    const expected = first?.keyword ?? 'a conforming shape';
    return {
      ok: false,
      reason: `Draft payload failed structural validation at ${where} (expected ${expected}, ${
        errors.length
      } problem${errors.length === 1 ? '' : 's'}).`,
    };
  }
  const draft = raw as WorldGenDraft;
  const diagnostics = validateWorldGenDraft(draft);
  if (diagnostics.length > 0) {
    const first = diagnostics[0] as WorldGenDraftDiagnostic;
    return {
      ok: false,
      reason:
        `Draft payload is structurally valid but incoherent (${first.code}) at ${first.path || 'draft'}: ` +
        first.message,
    };
  }
  return { ok: true, draft };
};

/**
 * The UTF-8 byte length of the draft as it is serialized for storage.
 *
 * `String.length` counts UTF-16 code units, which understates a draft full of
 * accented or CJK text by up to a factor of three — the exact case where a
 * "bounded" draft would overflow its column.
 */
export const worldGenDraftByteLength = (draft: WorldGenDraft): number =>
  new TextEncoder().encode(JSON.stringify(draft)).length;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Severity of a draft diagnostic. Every diagnostic is an error in G01. */
export const WorldGenDraftDiagnosticSchema = Type.Object(
  {
    /** Dotted path to the offending value, e.g. `arcs[2].questGiverIds[0]`. */
    path: Type.String({ minLength: 1, maxLength: 200 }),
    code: Type.Union([
      Type.Literal('duplicate_id'),
      Type.Literal('dangling_reference'),
      Type.Literal('count_limit'),
      Type.Literal('size_limit'),
      Type.Literal('missing_setting'),
      Type.Literal('duplicate_name'),
      Type.Literal('unreadable_storage'),
    ]),
    message: Type.String({ minLength: 1, maxLength: 400 }),
  },
  { additionalProperties: false },
);

export type WorldGenDraftDiagnostic = Static<typeof WorldGenDraftDiagnosticSchema>;

/**
 * The diagnostic emitted when the DEVICE STORE answered but the draft could
 * not be read back.
 *
 * Deliberately distinct from `size_limit`: a truncated column, a hand-edited
 * row and a store that throws all land here, and none of them is a size
 * problem. Labelling a corrupt row "size_limit" sends whoever reads the
 * diagnostics looking for an oversized draft that does not exist.
 */
export const WORLD_GEN_UNREADABLE_STORAGE_CODE = 'unreadable_storage' as const;

/** Builds the diagnostic shown when a stored draft could not be loaded. */
export const unreadableStorageDiagnostic = (reason: string): WorldGenDraftDiagnostic => ({
  path: 'draft',
  code: WORLD_GEN_UNREADABLE_STORAGE_CODE,
  message: `The stored draft could not be loaded and was ignored: ${reason}`,
});

/**
 * Checks a candidate draft for the properties the TypeBox schemas cannot
 * express: cross-item uniqueness, reference resolution, and total size.
 *
 * A diagnostic names the exact path and problem, so a failed generation can
 * tell the user which NPC reference is broken instead of "generation
 * failed".
 */
export const validateWorldGenDraft = (draft: WorldGenDraft): WorldGenDraftDiagnostic[] => {
  const diagnostics: WorldGenDraftDiagnostic[] = [];
  if (draft.setting === undefined) {
    diagnostics.push({
      path: 'setting',
      code: 'missing_setting',
      message: 'Draft has no resolved world setting; the setting stage did not complete.',
    });
  }
  diagnostics.push(..._duplicateIdDiagnostics(draft));
  diagnostics.push(..._duplicateNameDiagnostics(draft));
  diagnostics.push(..._danglingReferenceDiagnostics(draft));
  diagnostics.push(..._countLimitDiagnostics(draft));
  diagnostics.push(..._sizeLimitDiagnostic(draft));
  return diagnostics;
};

// ---------------------------------------------------------------------------
// Validation steps
//
// Each is a named step rather than a branch inside the caller, because a
// single "validate everything" function with six nested loops is unreadable and
// because a failed step should be traceable to the rule it enforces.
// ---------------------------------------------------------------------------

/** Stable ids must be unique across every collection that owns them. */
const _duplicateIdDiagnostics = (draft: WorldGenDraft): WorldGenDraftDiagnostic[] => {
  const diagnostics: WorldGenDraftDiagnostic[] = [];
  const seen = new Map<string, string>();
  const claim = (id: string, path: string): void => {
    const first = seen.get(id);
    if (first === undefined) {
      seen.set(id, path);
      return;
    }
    diagnostics.push({
      path,
      code: 'duplicate_id',
      message: `Stable id "${id}" is already used at ${first}; ids must be unique.`,
    });
  };
  for (const [index, npc] of draft.cast.entries()) {
    claim(npc.id, `cast[${index}].id`);
  }
  for (const [index, place] of draft.places.entries()) {
    claim(place.id, `places[${index}].id`);
  }
  for (const [index, arc] of draft.arcs.entries()) {
    claim(arc.id, `arcs[${index}].id`);
  }
  for (const [index, widget] of draft.hudWidgets.entries()) {
    claim(widget.id, `hudWidgets[${index}].id`);
  }
  return diagnostics;
};

/**
 * Duplicate display names are a coherence defect.
 *
 * The stage merger disambiguates same-named cast members (stable id AND display
 * label), so a draft built through the pipeline never trips this. The check
 * exists because every other part of the product — the GM prompt, the preview
 * UI, a future compiler — refers to cast members by NAME, so an ambiguous label
 * is a real defect if one ever arrives from a provider, a hand-built draft, or
 * an older persisted row.
 */
const _duplicateNameDiagnostics = (draft: WorldGenDraft): WorldGenDraftDiagnostic[] => {
  const counts = new Map<string, number>();
  for (const npc of draft.cast) {
    const key = npc.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const diagnostics: WorldGenDraftDiagnostic[] = [];
  for (const [key, count] of counts) {
    if (count > 1) {
      diagnostics.push({
        path: 'cast',
        code: 'duplicate_name',
        message:
          `${count} cast members share the name "${key}". Distinct ids are required; ` +
          'arcs reference cast members by id, not by name.',
      });
    }
  }
  return diagnostics;
};

/** Every cross-reference must resolve to a cast member. */
const _danglingReferenceDiagnostics = (draft: WorldGenDraft): WorldGenDraftDiagnostic[] => {
  const npcIds = new Set(draft.cast.map((npc) => npc.id));
  const diagnostics: WorldGenDraftDiagnostic[] = [];
  const check = (id: string, path: string): void => {
    if (npcIds.has(id)) {
      return;
    }
    diagnostics.push({
      path,
      code: 'dangling_reference',
      message: `Reference "${id}" does not resolve to a cast member.`,
    });
  };
  for (const [index, place] of draft.places.entries()) {
    place.npcIds.forEach((id, refIndex) => {
      check(id, `places[${index}].npcIds[${refIndex}]`);
    });
  }
  for (const [index, arc] of draft.arcs.entries()) {
    arc.questGiverIds.forEach((id, refIndex) => {
      check(id, `arcs[${index}].questGiverIds[${refIndex}]`);
    });
  }
  return diagnostics;
};

/** Re-assert the count ceilings even if a schema was bypassed upstream. */
const _countLimitDiagnostics = (draft: WorldGenDraft): WorldGenDraftDiagnostic[] => {
  const limits = WORLD_GEN_DRAFT_LIMITS;
  const checks: Array<[string, number, number]> = [
    ['cast', draft.cast.length, limits.maxNpcs],
    ['places', draft.places.length, limits.maxPlaces],
    ['arcs', draft.arcs.length, limits.maxArcs],
    ['hudWidgets', draft.hudWidgets.length, limits.maxHudWidgets],
  ];
  return checks
    .filter(([, actual, max]) => actual > max)
    .map(([path, actual, max]) => ({
      path,
      code: 'count_limit' as const,
      message: `${path} contains ${actual} entries; the limit is ${max}.`,
    }));
};

/** The serialized draft must fit the byte ceiling. */
const _sizeLimitDiagnostic = (draft: WorldGenDraft): WorldGenDraftDiagnostic[] => {
  const bytes = worldGenDraftByteLength(draft);
  if (bytes <= WORLD_GEN_DRAFT_LIMITS.maxBytes) {
    return [];
  }
  return [
    {
      path: '',
      code: 'size_limit',
      message: `Draft is ${bytes} bytes; the limit is ${WORLD_GEN_DRAFT_LIMITS.maxBytes} bytes.`,
    },
  ];
};

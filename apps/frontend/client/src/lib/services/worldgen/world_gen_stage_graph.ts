// apps/frontend/client/src/lib/services/worldgen/world_gen_stage_graph.ts
//
// G01 — the world-generation stage graph, as pure data + pure functions.
//
// The graph is written out BEFORE any parallelism so "which stage may run now,
// and what invalidates it" is a fact about the code rather than a consequence
// of call order:
//
//        ┌──────────┐
//        │ setting  │  shared premise, themes, tone constraints
//        └────┬─────┘
//   ┌─────────┼─────────┐
//   ▼         ▼         ▼
// ┌───────┐ ┌────────┐ ┌───────────┐
// │ cast  │ │ places │ │hudWidgets│   mutually independent
// └───┬───┘ └────────┘ └───────────┘
//     │  quest-giver ids must resolve
//     ▼
// ┌───────────┐
// │   arcs    │
// └───────────┘
//
// Two properties matter and are tested directly:
//
//   1. A stage's fingerprint depends on EXACTLY the inputs that stage reads.
//      Change `goals` and `hudWidgets` is invalidated while a stage that reads
//      only the resolved setting is not.
//   2. Invalidation is transitive: changing `setting` must also invalidate
//      `cast`, `places`, `hudWidgets` and `arcs`.
//
// Property 1 is only meaningful if "reads" means "the prompt was given it".
// That is why {@link WORLD_GEN_STAGE_INPUTS} is a single table consumed by BOTH
// {@link worldGenStageInputs} (which assembles the prompt) and
// {@link stageFingerprint} (which decides validity). A fingerprint may include
// MORE than the prompt renders — that over-invalidates, which costs a provider
// call. It may never include LESS, because that under-invalidates, which
// silently splices a cast generated against the old premise onto the new one.
//
// No service imports live here — this module is importable by unit tests and by
// the dev sandbox without dragging the client service registry in.

import type {
  WorldGenDraftInput,
  WorldGenDraftNpc,
  WorldGenDraftSetting,
  WorldGenDraftStage,
} from '@aikami/schemas';
import { jcsStringify } from '@aikami/utils';

/** Ordered generation stages — the order is the dependency order. */
export const WORLD_GEN_STAGES: readonly WorldGenDraftStage[] = [
  'setting',
  'cast',
  'places',
  'hudWidgets',
  'arcs',
] as const;

/** Direct dependencies of each stage. Internal: `readyStages` is the accessor. */
const WORLD_GEN_STAGE_GRAPH: Record<WorldGenDraftStage, readonly WorldGenDraftStage[]> = {
  setting: [],
  cast: ['setting'],
  places: ['setting'],
  hudWidgets: ['setting'],
  arcs: ['cast'],
};

/** Human-readable label per stage, used in status and error messages. */
export const WORLD_GEN_STAGE_LABELS: Record<WorldGenDraftStage, string> = {
  setting: 'world premise',
  cast: 'character roster',
  places: 'locations',
  hudWidgets: 'HUD widgets',
  arcs: 'story arcs',
};

/**
 * The resolved context a stage may read. Each stage sees only the slice named
 * in {@link WORLD_GEN_STAGE_GRAPH} — this is what makes the fingerprints
 * honest, because a stage cannot accidentally depend on something it never
 * received.
 */
export type WorldGenStageContext = {
  input: WorldGenDraftInput;
  setting: WorldGenDraftSetting | undefined;
  cast: readonly WorldGenDraftNpc[];
};

/**
 * Exactly what one stage is GIVEN: the wizard answers it may read, the parts of
 * the resolved premise it may read, and whether the cast roster is in scope.
 *
 * This table is the single source of truth for both the prompt and the
 * fingerprint. Before it existed, every prompt embedded `JSON.stringify(input)`
 * — the whole wizard form — while the fingerprints were hand-written per stage.
 * The two disagreed, so `cast` and `places` kept their checkpoints across a
 * goals edit that had in fact been sent to the provider again.
 */
export type WorldGenStageInputSlice = {
  readonly inputKeys: readonly (keyof WorldGenDraftInput)[];
  readonly settingFields: readonly SettingField[];
  /** Whether the already-generated cast roster is in scope for this stage. */
  readonly castRoster: boolean;
};

const ALL_INPUT_KEYS: readonly (keyof WorldGenDraftInput)[] = [
  'genre',
  'tone',
  'setting',
  'difficulty',
  'goals',
];
type SettingField = 'worldName' | 'worldDescription' | 'themes';

const ALL_SETTING_FIELDS: readonly SettingField[] = ['worldName', 'worldDescription', 'themes'];

/**
 * What each stage is given. See {@link WorldGenStageInputSlice}.
 *
 * Deliberately NOT exported: the table is consumed only through
 * {@link worldGenStageInputs}, which is what both the prompt and the fingerprint
 * use. Exporting it would hand callers a second, independent way to ask "what
 * does this stage read" — and the moment the two disagree, the fingerprint is
 * lying again.
 */
const WORLD_GEN_STAGE_INPUTS: Record<WorldGenDraftStage, WorldGenStageInputSlice> = {
  // The premise is built FROM the answers, so it reads all of them.
  setting: { inputKeys: ALL_INPUT_KEYS, settingFields: [], castRoster: false },
  // The roster is derived from the premise alone. The player answers have
  // already been expressed by the premise the provider actually wrote.
  cast: { inputKeys: [], settingFields: ALL_SETTING_FIELDS, castRoster: false },
  places: { inputKeys: [], settingFields: ALL_SETTING_FIELDS, castRoster: false },
  // Widgets are written against the player's stated goals and tone, so an edit
  // to either must invalidate them even though the premise is unchanged.
  hudWidgets: { inputKeys: ['goals', 'tone'], settingFields: ['worldName'], castRoster: false },
  // Arcs ARE the goals expressed as chapters, and their quest-givers must come
  // from a cast that exists by now.
  arcs: { inputKeys: ['goals'], settingFields: ['worldName'], castRoster: true },
};

/** The resolved, canonical inputs one stage is given. Rendered by the prompt. */
export type WorldGenStageInputs = {
  /** Wizard answers in scope, absent keys omitted. */
  input: Record<string, string>;
  /** Premise fields in scope. Absent premise yields `{}`. */
  setting: Record<string, unknown>;
  /** Cast roster lines. Present only when the roster is in scope. */
  cast?: readonly string[];
};

/** Resolves one stage's input slice against the current context. */
export const worldGenStageInputs = (
  stage: WorldGenDraftStage,
  context: WorldGenStageContext,
): WorldGenStageInputs => {
  const slice = WORLD_GEN_STAGE_INPUTS[stage];
  const input: Record<string, string> = {};
  for (const key of slice.inputKeys) {
    const value = context.input[key];
    // Absent keys are OMITTED rather than written as `undefined`. A canonical
    // serializer has no representation for `undefined`, and a member that
    // serializes differently depending on whether it exists is precisely the
    // kind of delimiter collision a fingerprint must not have.
    if (value !== undefined) {
      input[key] = value;
    }
  }
  const setting: Record<string, unknown> = {};
  if (context.setting !== undefined) {
    for (const key of slice.settingFields) {
      const value = context.setting[key] as unknown;
      if (value !== undefined) {
        setting[key] = value;
      }
    }
  }
  return slice.castRoster
    ? {
        input,
        setting,
        cast: context.cast.map((npc) => `${npc.name} (${npc.role}) — id ${npc.id}`),
      }
    : { input, setting };
};

/** Returns the stages that are ready to run given what has completed. */
export const readyStages = (
  completed: ReadonlySet<WorldGenDraftStage>,
  aborted: boolean,
): WorldGenDraftStage[] => {
  if (aborted) {
    return [];
  }
  return WORLD_GEN_STAGES.filter(
    (stage) =>
      !completed.has(stage) &&
      WORLD_GEN_STAGE_GRAPH[stage].every((dependency) => completed.has(dependency)),
  );
};

/**
 * A BOUNDED, deterministic, collision-resistant fingerprint of one stage's
 * inputs.
 *
 * Three constraints forced the shape:
 *
 *   * BOUNDED — the persisted checkpoint schema caps `fingerprint` at 128
 *     characters, and a stage's inputs include a free-text premise of up to
 *     2000 characters. The raw joined text therefore cannot be the fingerprint;
 *     a draft that hashed its premise into a 128-char column was guaranteed to
 *     fail its own schema on the way to disk.
 *   * DETERMINISTIC and canonical — the comparison is a string equality across
 *     separate runs and across a process restart, so member order and key order
 *     must not matter. RFC 8785 (JCS) gives that.
 *   * COLLISION-RESISTANT — FNV-1a over the canonical bytes with explicit
 *     length-prefixed framing. This is NOT a cryptographic digest and is not
 *     used as a security boundary; a collision would at worst keep one stale
 *     checkpoint, which the cross-reference validation downstream still
 *     catches. Two 32-bit lanes are used rather than one because a single
 *     32-bit lane collides in the birthday sense at ~77k distinct inputs,
 *     which a long-lived draft id space will eventually reach.
 *
 * The framing is what makes it collision-resistant rather than merely hashed:
 * `["ab","c"]` and `["a","bc"]` hash identically without a separator, so every
 * component is prefixed with its character length.
 */
const fingerprintInput = (stage: WorldGenDraftStage, context: WorldGenStageContext): string => {
  const parts = [stage, jcsStringify(worldGenStageInputs(stage, context))];
  const framed = parts.map((part) => `${part.length}:${part}`).join('|');
  const bytes = new TextEncoder().encode(framed);

  const OffsetA = 0x811c9dc5;
  const OffsetB = 0x01000193;
  const PrimeA = 0x01000193;
  const PrimeB = 0x85ebca6b;
  let a = OffsetA;
  let b = OffsetB;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, PrimeA) >>> 0;
    b = Math.imul(b ^ (byte + a), PrimeB) >>> 0;
  }
  const hex = (value: number): string => value.toString(16).padStart(8, '0');
  return `wgf1-${bytes.length.toString(16)}-${hex(a)}-${hex(b)}`;
};

/**
 * Everything a stage's output actually depends on, folded into a stable
 * fingerprint.
 *
 * Derived from {@link worldGenStageInputs} — the same resolution the prompt
 * uses — so a stage can never be declared valid against inputs its prompt did
 * not carry.
 */
export const stageFingerprint = (
  stage: WorldGenDraftStage,
  context: WorldGenStageContext,
): string => fingerprintInput(stage, context);

/**
 * The stages that must be re-run because `changed` (or something it feeds) no
 * longer has the fingerprint its checkpoint was recorded under.
 *
 * @param checkpoints - stage → fingerprint recorded when that stage succeeded.
 * @param context - the current resolved context, for fingerprint comparison.
 * @returns the stages with no valid checkpoint, in execution order.
 */
export const invalidatedStages = (
  checkpoints: ReadonlyMap<WorldGenDraftStage, string>,
  context: WorldGenStageContext,
): WorldGenDraftStage[] =>
  WORLD_GEN_STAGES.filter((stage) => {
    const recorded = checkpoints.get(stage);
    return recorded === undefined || recorded !== stageFingerprint(stage, context);
  });

/**
 * Transitive dependents of `changed`, including `changed` itself.
 *
 * This is the "a changed NPC roster invalidates arcs" rule, stated once.
 */
export const stagesInvalidatedBy = (
  changed: ReadonlySet<WorldGenDraftStage>,
): WorldGenDraftStage[] => {
  const invalidated = new Set(changed);
  // `arcs` depends on `cast`; a future stage with a longer chain is handled
  // by the same loop because the graph is walked to a fixed point.
  let grew = true;
  while (grew) {
    grew = false;
    for (const stage of WORLD_GEN_STAGES) {
      if (invalidated.has(stage)) {
        continue;
      }
      if (WORLD_GEN_STAGE_GRAPH[stage].some((dependency) => invalidated.has(dependency))) {
        invalidated.add(stage);
        grew = true;
      }
    }
  }
  return WORLD_GEN_STAGES.filter((stage) => invalidated.has(stage));
};

// ---------------------------------------------------------------------------
// Stable id assignment
// ---------------------------------------------------------------------------

/** Lower-cased, hyphenated, ASCII-ish slug used as the id stem. */
const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/**
 * Allocates stable, collision-free ids of the form `npc_maren`,
 * `npc_maren-2`, `npc_maren-3` …
 *
 * Two NPCs may legitimately share a display name — the provider is asked for
 * a roster, not a registry. Referencing them by name would make the second
 * "Maren" unreachable, so ids are derived from the name and DE-DUPLICATED
 * here. The first claimant keeps the bare slug, which keeps ids readable and
 * makes them stable across runs for the common (no-collision) case.
 */
export const allocateStableIds = (prefix: string, names: readonly string[]): string[] => {
  const used = new Set<string>();
  const ids: string[] = [];
  for (const name of names) {
    const stem = slugify(name) || `${prefix}-anon`;
    let candidate = `${prefix}_${stem}`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${prefix}_${stem}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    ids.push(candidate);
  }
  return ids;
};

/**
 * Resolves provider-supplied quest-giver references against the allocated
 * cast, returning ids plus the references that could not be resolved.
 *
 * Resolution is by exact display name first (the common case), then by a
 * case-insensitive match. An unresolvable reference is REPORTED, never
 * silently dropped — a quest whose giver vanished is a coherence bug the user
 * must be able to see.
 */
export const resolveQuestGiverNames = (
  references: readonly string[],
  cast: readonly { id: string; name: string }[],
): { ids: string[]; unresolved: string[] } => {
  const byName = new Map<string, string[]>();
  for (const npc of cast) {
    const key = npc.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), npc.id]);
  }
  const taken = new Set<string>();
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const reference of references) {
    const key = reference.trim().toLowerCase();
    const candidates = byName.get(key) ?? [];
    const id = candidates.find((candidate) => !taken.has(candidate));
    if (id === undefined) {
      unresolved.push(reference);
      continue;
    }
    taken.add(id);
    ids.push(id);
  }
  return { ids, unresolved };
};

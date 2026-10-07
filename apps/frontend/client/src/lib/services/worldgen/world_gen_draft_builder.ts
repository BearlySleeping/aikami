// apps/frontend/client/src/lib/services/worldgen/world_gen_draft_builder.ts
//
// G01 — assembling a draft from provider payloads.
//
// Split out of `world_gen_draft_service.svelte.ts` so the two responsibilities
// stay separable: that module owns the RUN (identity, cancellation, deadlines,
// checkpoints, persistence); this one owns the DATA (what a stage's payload
// becomes, which ids it gets, which references resolve). Neither imports the
// other's lifecycle.

import type { WorldGenDraft, WorldGenDraftStage } from '@aikami/schemas';
import { allocateStableIds, resolveQuestGiverNames } from './world_gen_stage_graph.ts';

/** Maximum themes accepted from the premise stage. */
const MAX_THEMES = 8;

/**
 * The mutable accumulator a run fills, stage by stage.
 *
 * Ids are allocated deterministically from display names so two cast members
 * called "Maren" get distinct, individually referencable ids.
 */
export type WorldGenDraftAccumulator = {
  setting: WorldGenDraft['setting'];
  cast: WorldGenDraft['cast'];
  places: WorldGenDraft['places'];
  arcs: WorldGenDraft['arcs'];
  hudWidgets: WorldGenDraft['hudWidgets'];
};

/** A fresh, empty accumulator. */
export const createDraftAccumulator = (): WorldGenDraftAccumulator => ({
  setting: undefined,
  cast: [],
  places: [],
  arcs: [],
  hudWidgets: [],
});

/**
 * Makes a batch of display names unique by appending an ordinal to repeats.
 *
 * The provider is asked for a roster, not a registry, so two "Maren"s are a
 * legitimate outcome rather than an error. Stable ids already keep them
 * individually referencable; disambiguating the LABEL is what stops the GM
 * prompt and the preview UI from presenting two characters the player cannot
 * tell apart.
 *
 * Applied when the draft is assembled — NOT while absorbing the cast, because
 * the arcs stage must still be able to resolve a quest-giver name against the
 * labels the provider actually wrote.
 */
export const disambiguateNames = (names: readonly string[]): string[] => {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.trim().toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? name : `${name} (${count})`;
  });
};

// ---------------------------------------------------------------------------
// Stage absorption
// ---------------------------------------------------------------------------

/**
 * Folds one stage's provider payload into the accumulator.
 *
 * @throws When the payload cannot be turned into something coherent (a premise
 * with no name, for instance). The caller turns that into a named stage failure.
 */
export const absorbStage = (
  target: WorldGenDraftAccumulator,
  stage: WorldGenDraftStage,
  raw: unknown,
): void => {
  const value = asRecord(raw);
  switch (stage) {
    case 'setting':
      target.setting = readSetting(value);
      return;
    case 'cast':
      target.cast = readCast(value);
      return;
    case 'places':
      target.places = readPlaces(value);
      return;
    case 'hudWidgets':
      target.hudWidgets = readHudWidgets(value);
      return;
    case 'arcs':
      target.arcs = readArcs(value, target.cast);
      return;
    default: {
      const _never: never = stage;
      throw new Error(`Unhandled stage: ${String(_never)}`);
    }
  }
};

const readSetting = (value: Record<string, unknown>): WorldGenDraft['setting'] => {
  const worldName = asString(value.worldName);
  const worldDescription = asString(value.worldDescription);
  if (worldName === undefined || worldDescription === undefined) {
    throw new Error('The world premise stage returned no world name or description.');
  }
  return {
    worldName,
    worldDescription,
    themes: asStringArray(value.themes).slice(0, MAX_THEMES),
  };
};

const readCast = (value: Record<string, unknown>): WorldGenDraft['cast'] => {
  const npcs = asArray(value.npcs);
  const names = npcs.map((npc) => asString(asRecord(npc).name) ?? '');
  const ids = allocateStableIds('npc', names);
  return npcs.map((npc, index) => {
    const record = asRecord(npc);
    return {
      id: ids[index] as string,
      name: names[index] as string,
      race: asString(record.race) ?? 'Unknown',
      class: asString(record.class) ?? 'Unknown',
      role: asString(record.role) ?? 'Unknown',
      description: asString(record.description) ?? '',
      personality: asString(record.personality) ?? '',
    };
  });
};

const readPlaces = (value: Record<string, unknown>): WorldGenDraft['places'] => {
  const places = asArray(value.places);
  const names = places.map((place) => asString(asRecord(place).name) ?? 'Unnamed');
  // Allocated in ONE call so two places sharing a name still get distinct ids;
  // allocating per item would hand both the bare slug.
  const ids = allocateStableIds('place', names);
  return places.map((place, index) => {
    const record = asRecord(place);
    return {
      id: ids[index] as string,
      name: names[index] as string,
      description: asString(record.description) ?? '',
      // Keep references for final validation after the sibling cast settles.
      // Filtering here would silently discard both invalid and not-yet-known ids.
      npcIds: asStringArray(record.npcIds),
    };
  });
};

const readHudWidgets = (value: Record<string, unknown>): WorldGenDraft['hudWidgets'] =>
  asArray(value.hudWidgets).map((widget, index) => {
    const record = asRecord(widget);
    const label = asString(record.label) ?? `Widget ${index + 1}`;
    return {
      id: `hud_${index}-${slug(label)}`,
      slot: asString(record.slot) ?? 'top-left',
      label,
      icon: asString(record.icon) ?? 'star',
      defaultVisibility: record.defaultVisibility !== false,
    };
  });

const readArcs = (
  value: Record<string, unknown>,
  cast: WorldGenDraft['cast'],
): WorldGenDraft['arcs'] => {
  const arcs = asArray(value.arcs);
  const chapters = arcs.map((arc, index) => {
    const chapter = asString(asRecord(arc).chapter);
    return chapter === undefined || chapter.length === 0 ? `Chapter ${index + 1}` : chapter;
  });
  const ids = allocateStableIds('arc', chapters);
  return arcs.map((arc, index) => {
    const record = asRecord(arc);
    // The provider is asked for NAMES (it has not seen ids yet); they resolve to
    // stable ids here. A name that cannot be resolved is reported by validation
    // rather than silently becoming a broken reference.
    const { ids: giverIds, unresolved } = resolveQuestGiverNames(
      asStringArray(record.questGiverNames),
      cast,
    );
    if (unresolved.length > 0) {
      throw new Error(
        `Story arc ${chapters[index]} has unknown quest givers: ${unresolved.join(', ')}`,
      );
    }
    return {
      id: ids[index] as string,
      chapter: chapters[index] as string,
      description: asString(record.description) ?? '',
      objectives: asStringArray(record.objectives),
      questGiverIds: giverIds,
    };
  });
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  asArray(value).filter((entry): entry is string => typeof entry === 'string');

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'widget';

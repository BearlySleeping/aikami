// apps/frontend/client/src/lib/services/npc/npc_prompt_projection.ts
//
// Compiled-prompt reuse and task-specific world-state projection (issue #382).
//
// WHY THIS EXISTS
//
// Two measurements, both on the pinned local runtime, produced this module.
//
//   1. PROMPT CONSTRUCTION IS MOSTLY RE-DERIVATION. Measured with
//      `scripts/ai_context_reuse_probe.ts` (P1), a second opener refresh for
//      the same NPC against an unchanged world re-read **99.4%** of the
//      previous prompt's characters, and the digest system prompt — which is
//      pure template plus persona — re-read **98.3%**. That is not a provider
//      cost by itself: a provider is only paid for what it is sent. It IS a
//      client cost, paid on every turn and every background call, and it is
//      the thing a "compiled prompt" cache can honestly remove.
//
//   2. THE BACKGROUND PROMPTS CARRY DIALOGUE-GRADE CONTEXT. The same probe
//      found the ~190-character GM difficulty-guidance paragraph and the
//      equipped-items list inside prompts sent to two BOUNDED background
//      tasks — a memory digest and an opener refresh — which act on neither.
//      The guidance tells a live NPC how blunt to be with the player; a digest
//      writing a private memory note has no use for it.
//
// WHAT THIS IS NOT
//
//   - NOT a result cache. It never stores a model's answer. It stores
//     *projections the client builds itself*, from its own content, and every
//     entry is a pure function of inputs the caller already holds.
//   - NOT a semantic-similarity cache. A key is a content hash. Two different
//     personas never share an entry because they are "similar".
//   - NOT a provider prefix cache. Whether the provider itself reuses a cached
//     KV prefix is the provider's business and is reported separately
//     (`prompt_eval_cached_count`, and UNKNOWN on every runtime not measured).
//   - NOT a place to hide a truncation. Everything dropped is named in
//     {@link BACKGROUND_EXCLUDED_FACT_PREFIXES} and covered by a test.
//
// THE PROJECTION BOUNDARY
//
// `buildGameStateFacts` produces a DIALOGUE projection. Reusing it verbatim for
// a background memory task is the defect. The split is explicit:
//
//   - REQUIRED, kept: gold, inventory, active quests, offerable quests,
//     difficulty, relationship/faction standing. A digest must know what the
//     player is carrying and working toward, or the memory it writes is wrong.
//   - EXCLUDED, named: the GM difficulty-guidance paragraph, the equipped-items
//     list, the easy-mode item hint. These are instructions to a live
//     conversational NPC. A background memory call has no player turn to
//     steer.
//
// The excluded set is matched by PREFIX and asserted in tests, so a new
// dialogue-only fact is not silently carried into a background prompt by
// accident — it has to be classified.

// ---------------------------------------------------------------------------
// World-state projection
// ---------------------------------------------------------------------------

/**
 * Dialogue-only facts, identified by the prefix each one is emitted under.
 *
 * A prefix rather than an exact string, because these facts carry live values
 * ("Gold: 412", an inventory listing) that change every turn. The PREFIX is the
 * stable contract; the value is not.
 *
 * Each entry is excluded from background prompts because the background tasks
 * do not act on it:
 *
 *   - `Game difficulty:` carries the ~190-character GM guidance paragraph. It
 *     instructs a LIVE NPC how explicitly to steer the player. A digest
 *     writing a private memory note cannot act on it, and a returning
 *     greeting generated under "be very direct" guidance reads as a
 *     non-sequitur in a memory context.
 *   - `Equipped:` is loadout detail. Memory is about relationships, promises
 *     and what the player asked for — not which slot a lantern is in.
 *   - `Hint (easy mode only):` is the same guidance in item form.
 */
const BACKGROUND_EXCLUDED_FACT_PREFIXES: readonly string[] = [
  'Game difficulty:',
  'Equipped:',
  'Hint (easy mode only):',
];

/** Facts a background memory task cannot do its job without. */
const BACKGROUND_REQUIRED_FACT_PREFIXES: readonly string[] = [
  'Gold:',
  'Inventory:',
  'Active quest:',
  'Offerable quests:',
];

/**
 * Projects a dialogue-grade world-state fact list down to what a bounded
 * background memory task can act on.
 *
 * Order is preserved, so a caller comparing two projections sees only the
 * removals. An EMPTY result is possible and is not an error: a brand-new game
 * with no quests and no gold still produces `Gold: 0`, but a caller that
 * passes an already-empty list gets an empty list, and the prompt builders
 * already render that as `(unknown)`.
 */
export const buildBackgroundWorldStateProjection = (facts: readonly string[]): string[] =>
  facts.filter(isBackgroundProjectedFact);

/** Whether a fact survives the background projection. */
const isBackgroundProjectedFact = (fact: string): boolean =>
  !BACKGROUND_EXCLUDED_FACT_PREFIXES.some((prefix) => fact.startsWith(prefix));

/**
 * The bounded budget, in characters, for a background world-state projection.
 *
 * The upstream `buildGameStateFacts` cap is a COUNT cap (`MAX_TOTAL_FACTS`),
 * and a count cap does not bound CHARACTERS: eight facts that are all long
 * inventory listings is a very different prompt from eight short ones. This is
 * a character cap on top, so a pathological projection cannot grow the
 * background prompt without limit.
 *
 * Deliberately generous against the measured prompt sizes in P1: the
 * `openerUser` prompt measured 2 190 characters in total, and this cap is
 * applied to the world-state slice alone.
 */
const BACKGROUND_FACT_CHARS_LIMIT = 900;

// ---------------------------------------------------------------------------
// Compiled-prompt cache
// ---------------------------------------------------------------------------

/** A compiled immutable prompt block, plus how it was derived. */
export type CompiledPromptBlock = {
  /** The compiled text. Stable for a given key. */
  readonly text: string;
  /** The key it was compiled under. */
  readonly key: string;
};

/** Content-free counters. Never a prompt, a persona or a player word. */
export type PromptCacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  entries: number;
  /** Total characters currently held, for the size bound. */
  chars: number;
};

export type NpcPromptCache = {
  /**
   * Returns the compiled block for `key`, calling `compile` on a miss.
   *
   * `compile` is invoked AT MOST ONCE per live key. A caller whose content
   * changed must therefore produce a DIFFERENT key — that is the whole
   * contract, and it is why every key here is a content hash rather than an
   * identifier.
   */
  get(key: string, compile: () => string): CompiledPromptBlock;
  /** Drops every entry and zeroes the counters. Called on lifecycle changes. */
  clear(): void;
  /** Content-free snapshot. */
  stats(): PromptCacheStats;
};

/** Default entry ceiling. Sized for a campaign, not for a single turn. */
const DEFAULT_MAX_ENTRIES = 256;

/**
 * Default character ceiling.
 *
 * Deliberately small. A cached persona is a few hundred characters; 64 KiB
 * holds hundreds of them, and the point of the bound is that a pathological
 * caller cannot turn a cache into a leak. The hash keys are ~10 bytes each, so
 * the bookkeeping is not what this protects against.
 */
const DEFAULT_MAX_CHARS = 64 * 1024;

/**
 * LRU cache for compiled immutable prompt blocks, bounded by BOTH entry count
 * and total characters.
 *
 * Both bounds, not one: an entry ceiling alone does not bound memory when the
 * entries vary in size (a 400-character persona and a 40 000-character
 * lore block both count as one), and a character ceiling alone does not bound
 * the Map's own per-entry overhead.
 *
 * TTL is deliberately absent. Every key is a CONTENT hash, so an entry cannot
 * go stale — a changed input produces a different key and the old entry is
 * simply never looked up again, and `clear()` runs on the lifecycle events
 * that could otherwise retain a campaign's projections. A time-based
 * expiration here would expire entries that are still correct, which trades a
 * real cost for a cosmetic bound.
 */
export const createNpcPromptCache = (options?: {
  maxEntries?: number;
  maxChars?: number;
}): NpcPromptCache => {
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const maxChars = Math.max(1, options?.maxChars ?? DEFAULT_MAX_CHARS);

  /** Insertion-ordered: the first key is the least recently used. */
  const entries = new Map<string, CompiledPromptBlock>();
  let chars = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  const evict = (): void => {
    while (entries.size > maxEntries || chars > maxChars) {
      const oldest = entries.keys().next();
      if (oldest.done === true) {
        return;
      }
      const victim = entries.get(oldest.value);
      entries.delete(oldest.value);
      chars -= victim?.text.length ?? 0;
      evictions += 1;
    }
  };

  return {
    get(key, compile) {
      const found = entries.get(key);
      if (found !== undefined) {
        // Refresh recency: re-inserting moves the key to the newest position.
        entries.delete(key);
        entries.set(key, found);
        hits += 1;
        return found;
      }
      const text = compile();
      misses += 1;
      entries.set(key, { text, key });
      chars += text.length;
      evict();
      // A single entry larger than the whole budget must still be usable:
      // evicting it immediately would return an empty projection to a caller
      // that legitimately asked for one. It is held alone until the next
      // insert pushes it out, which is what the eviction loop already does.
      return { text, key };
    },

    clear() {
      entries.clear();
      chars = 0;
      hits = 0;
      misses = 0;
      evictions = 0;
    },

    stats() {
      return { hits, misses, evictions, entries: entries.size, chars };
    },
  };
};

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

/**
 * A key that changes when ANY of its parts change.
 *
 * Length-prefixed rather than joined with a separator, because a separator is
 * ambiguous: persona `"a|b"` + name `"c"` and persona `"a"` + name `"b|c"` are
 * the same key under a naive join and different blocks. The version is part of
 * the KEY, not just a comment, so changing how a block is compiled retires
 * every previously-compiled entry without a separate invalidation call.
 */
const promptCacheKey = (namespace: string, version: number, ...parts: readonly string[]): string =>
  [namespace, String(version), ...parts.map((part) => `${part.length}:${part}`)].join('|');

/**
 * Bumped whenever the SHAPE of a compiled block changes.
 *
 * Not bumped for a content change: that is what the content hash is for.
 */
const NPC_PROMPT_CACHE_VERSION = 1;

/** Namespaces, so two block kinds can never collide. */
const NPC_PROMPT_NAMESPACE = {
  digestSystem: 'digest-system',
  openerSystem: 'opener-system',
} as const;

/** The key a digest system prompt compiles under. */
export const digestSystemPromptKey = (persona: string, npcName: string): string =>
  promptCacheKey(NPC_PROMPT_NAMESPACE.digestSystem, NPC_PROMPT_CACHE_VERSION, persona, npcName);

/** The key an opener system prompt compiles under. */
export const openerSystemPromptKey = (persona: string, npcName: string): string =>
  promptCacheKey(NPC_PROMPT_NAMESPACE.openerSystem, NPC_PROMPT_CACHE_VERSION, persona, npcName);

// ---------------------------------------------------------------------------
// Bounded fact rendering
// ---------------------------------------------------------------------------

/**
 * Renders a background world-state projection, bounded in characters.
 *
 * The bound is DELIBERATE and OBSERVABLE: the caller can see, from the
 * returned value, that a projection was truncated, because the marker is in
 * the text. A truncation the caller cannot detect is a silent prompt change.
 *
 * Required facts are protected: they are emitted first and in order, and the
 * budget is applied to what remains. The required set is
 * {@link BACKGROUND_REQUIRED_FACT_PREFIXES} — a background memory call that
 * loses the quest the player is working on writes a worse memory, which is a
 * quality regression, not a cost saving.
 */
export const renderBackgroundFacts = (facts: readonly string[]): string => {
  if (facts.length === 0) {
    return '(unknown)';
  }
  const required: string[] = [];
  const optional: string[] = [];
  for (const fact of facts) {
    if (BACKGROUND_REQUIRED_FACT_PREFIXES.some((prefix) => fact.startsWith(prefix))) {
      required.push(fact);
    } else {
      optional.push(fact);
    }
  }
  const kept = [...required];
  let used = required.reduce((sum, fact) => sum + fact.length + 1, 0);
  let truncated = 0;
  for (const fact of optional) {
    const cost = fact.length + 1;
    if (used + cost > BACKGROUND_FACT_CHARS_LIMIT) {
      truncated += 1;
      continue;
    }
    kept.push(fact);
    used += cost;
  }
  if (truncated > 0) {
    // Observable: the reader of the prompt — and the caller — can both see
    // that something was left out.
    kept.push(`[${truncated} further world fact(s) omitted for length]`);
  }
  return kept.join('\n');
};

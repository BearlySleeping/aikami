// apps/frontend/client/src/lib/services/game/companion_reaction.ts
//
// Companion reaction authority (C-494 AC-4, AC-5).
//
// The contract's reaction vocabulary is expressed as authored content inside
// the existing `boundaries` / `agenda` strings via a fixed, documented
// convention:
//
//   `reaction|trigger`   e.g. "refuse|Threaten an innocent villager"
//
// where `reaction` is one of:
//   - `refuse`  — companion objects; approval drops to a floor (−20).
//   - `object`  — companion objects but keeps cooperating; no approval change.
//   - `leave`   — companion leaves the party via `dismiss`.
//
// This module is deliberately a thin, pure-ish helper: it parses the authored
// convention, detects a boundary crossing against a world/event trigger, and
// applies the resulting state change through the roster service. It is NOT a
// reaction engine — the prose and the trigger vocabulary are authored in the
// pack, and only the state mutation is mechanical.
//
// Idempotency: callers must key the reaction to the triggering event/operation
// identity (see `companion_reaction_service` usage in the dialogue seam) so a
// retry cannot double-drop approval or double-dismiss.

/** The companion reaction kinds the `reaction|trigger` convention supports. */
export type CompanionReactionKind = 'refuse' | 'object' | 'leave';

/** A parsed authored boundary entry. */
export type ParsedCompanionReaction = {
  /** The reaction to apply when the trigger fires. */
  reaction: CompanionReactionKind;
  /** The authored trigger phrase that describes the crossing. */
  trigger: string;
};

/**
 * Parses one `reaction|trigger` boundary string into its parts.
 * Returns undefined for entries that do not follow the convention (they are
 * ordinary authored prose, not reaction bindings).
 */
export const parseCompanionReaction = (boundary: string): ParsedCompanionReaction | undefined => {
  const sep = boundary.indexOf('|');
  if (sep <= 0) {
    return undefined;
  }
  const reaction = boundary.slice(0, sep).trim();
  const trigger = boundary.slice(sep + 1).trim();
  if (reaction !== 'refuse' && reaction !== 'object' && reaction !== 'leave') {
    return undefined;
  }
  if (trigger.length === 0) {
    return undefined;
  }
  return { reaction, trigger };
};

/**
 * Returns every parsed reaction binding among the NPC's authored boundaries.
 */
export const parseBoundaryReactions = (
  boundaries: readonly string[] | undefined,
): ParsedCompanionReaction[] => {
  if (!boundaries) {
    return [];
  }
  const parsed: ParsedCompanionReaction[] = [];
  for (const boundary of boundaries) {
    const binding = parseCompanionReaction(boundary);
    if (binding) {
      parsed.push(binding);
    }
  }
  return parsed;
};

/**
 * Detects whether a player action / committed event crosses one of the
 * companion's authored boundaries. The `trigger` is matched case-insensitively
 * against the event summary or the action description. Returns the first
 * matching binding (in author order), or undefined if nothing is crossed.
 */
export const detectBoundaryCrossing = (options: {
  boundaries: readonly string[] | undefined;
  /** The description of what the player just did / the committed event summary. */
  actionDescription: string;
}): ParsedCompanionReaction | undefined => {
  const { boundaries, actionDescription } = options;
  const needle = actionDescription.toLowerCase();
  for (const binding of parseBoundaryReactions(boundaries)) {
    if (needle.includes(binding.trigger.toLowerCase())) {
      return binding;
    }
  }
  return undefined;
};

/**
 * Applies a parsed companion reaction as a real state change through the
 * roster service:
 *   - `refuse` → approval drops by 20 (clamped by the roster service).
 *   - `object` → no approval change; the companion refuses cooperation. The
 *     caller surfaces the authored objection line; state is intentionally
 *     untouched so the companion can be won back.
 *   - `leave`  → the companion is dismissed from the party.
 *
 * Returns a machine-readable outcome for logging / observation.
 */
export const applyCompanionReaction = (options: {
  npcId: string;
  reaction: CompanionReactionKind;
  roster: {
    adjustApproval(options: { npcId: string; delta: number }): void;
    dismiss(npcId: string): boolean;
    hasMember(npcId: string): boolean;
  };
}): { applied: CompanionReactionKind; approvalDelta: number; dismissed: boolean } => {
  const { npcId, reaction, roster } = options;
  if (!roster.hasMember(npcId)) {
    return { applied: reaction, approvalDelta: 0, dismissed: false };
  }

  switch (reaction) {
    case 'refuse':
      roster.adjustApproval({ npcId, delta: -20 });
      return { applied: reaction, approvalDelta: -20, dismissed: false };
    case 'object':
      // Objection is prose-only by design — the companion keeps cooperating.
      return { applied: reaction, approvalDelta: 0, dismissed: false };
    case 'leave': {
      const dismissed = roster.dismiss(npcId);
      return { applied: reaction, approvalDelta: 0, dismissed };
    }
  }
};

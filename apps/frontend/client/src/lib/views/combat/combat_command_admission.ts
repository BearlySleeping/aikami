// apps/frontend/client/src/lib/views/combat/combat_command_admission.ts
//
// The client half of the v2 command-admission envelope (review F-B).
//
// Every ordinary v2 command the client sends must carry the identity the engine
// admits it against: which encounter, which execution run, which turn, which
// actor and which revision. A user-supplied actor id or controller label is
// PROVENANCE, never authorisation — the engine derives ownership from its own
// session state — so this module mints correlation identity only and never
// decides legality.
//
// The envelope is minted at the moment of the send, from the last values the
// engine reported. A command the player confirmed earlier carries the revision
// it was confirmed against (the compiled plan's `basedOnRevision`), not the
// live counter, so a delayed confirmation is refused rather than resolved
// against a state the player never saw.

/** The identity block carried by every ordinary v2 command. */
export type CombatCommandIdentity = {
  /** Unique per command attempt; the engine's idempotency key. */
  commandId: string;
  /** The authored encounter the command belongs to. */
  encounterId: string;
  /** The execution run the command was confirmed against. */
  encounterRunId: string;
  /** The acting stable combatant id (authored, never an eid). */
  combatantId: string;
  /** The turn identity the command was confirmed on. */
  turnId: string;
  /** The revision the command was confirmed against. */
  basedOnRevision: number;
};

/** What the admission minter reads from the surface that owns the fight. */
export type CombatCommandAdmissionSource = {
  readEncounterId(): string;
  readEncounterRunId(): string;
  readTurnId(): string;
  readActiveCombatantId(): string;
  readRevision(): number;
};

export type CombatCommandAdmission = {
  /**
   * Mints the identity block for one command.
   *
   * `basedOnRevision` is overridable so the caller can bind a command to the
   * revision a compiled plan was confirmed against instead of the live one.
   */
  mint(overrides?: Partial<CombatCommandIdentity>): CombatCommandIdentity;
};

/**
 * Creates the minter.
 *
 * `commandId` is minted from a monotonic counter plus a random suffix so two
 * attempts can never collide across a reload, a worker restart or two tabs
 * sharing one session store.
 */
export const createCombatCommandAdmission = (
  source: CombatCommandAdmissionSource,
): CombatCommandAdmission => {
  let counter = 0;
  return {
    mint: (overrides) => {
      counter += 1;
      const suffix = Math.random().toString(36).slice(2, 8);
      return {
        commandId: `cmd-${counter}-${Date.now().toString(36)}-${suffix}`,
        encounterId: source.readEncounterId(),
        encounterRunId: source.readEncounterRunId(),
        combatantId: source.readActiveCombatantId(),
        turnId: source.readTurnId(),
        basedOnRevision: source.readRevision(),
        ...overrides,
      };
    },
  };
};

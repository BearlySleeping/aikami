// packages/shared/utils/src/lib/rules/combat_rules_version.ts
//
// The rules-version policy for Combat 2.0.
//
// A LEAF module: the kernel, the save preflight and the replay helpers all need
// the supported set without importing each other.
//
// Contract: C-509 AC-1, C-532 AC-6

/** Rules version stamped on every state this kernel creates. */
export const COMBAT_RULES_VERSION = 'combat-2.0.0';

/**
 * Every rules version this build is willing to EXECUTE (review F-B/F7).
 *
 * A historical rules version is refused rather than silently resolved with
 * today's kernel: the mechanical meaning of a command can change between
 * versions, so executing an old state under new rules would produce a fight the
 * player never had. A restore/replay of an unsupported version fails with a
 * typed reason and leaves the original save untouched.
 */
export const SUPPORTED_COMBAT_RULES_VERSIONS: readonly string[] = [COMBAT_RULES_VERSION];

/** Whether a recorded rules version may be executed by this build. */
export const isSupportedCombatRulesVersion = (rulesVersion: string): boolean =>
  SUPPORTED_COMBAT_RULES_VERSIONS.includes(rulesVersion);

// packages/frontend/ai-gateway/src/lib/decision/checkpoint_limits.ts
//
// Per-CHECKPOINT structural limits for native llama.cpp decision inference
// (issue #381).
//
// Why this file exists
// --------------------
// Upstream states that "the number of options of a `choice` question is limited
// by the model" and gives two different numbers: 52 for OpenJev, 255 for Laya
// and clef. It states no limit for julia-1, lev or kev. Those ceilings are a
// property of the checkpoint's trained vocabulary and output head — they are not
// a property of the dialect, the server build, or Aikami's schema compiler.
//
// Copying one model's ceiling to another is therefore not a default, it is a
// guess that produces a 400 from upstream on a perfectly valid plan. And
// silently TRUNCATING the option list to fit is worse than either: it asks the
// model a different question than the plan compiled and then reconstructs a
// value from an answer nobody gave, which is how an out-of-scope answer becomes
// an in-scope one.
//
// So: every limit here is attributed to a source, a limit whose value is
// UNKNOWN is reported as unknown rather than filled in from a sibling model, and
// the adapter refuses a plan that exceeds a known limit before dispatch.

/** Where a limit's value came from. Carried into diagnostics, never dropped. */
export type CheckpointLimitSource =
  /** Upstream publishes this number for this checkpoint family. */
  | 'upstream-documented'
  /** Measured against a built server + loaded checkpoint in this repository. */
  | 'measured'
  /** Observed as the hard refusal point of this specific checkpoint. */
  | 'measured-rejected'
  /**
   * NOT A MEASUREMENT — the conservative bound below, applied because this
   * checkpoint's real ceiling is unknown.
   *
   * Deliberately its own value so it can never be read as, or reported as,
   * evidence about the checkpoint. A settings screen or an audit that says
   * "measured" here is claiming something nobody established.
   */
  | 'unknown-fallback';

/** One checkpoint family's real limits. */
export type CheckpointLimits = {
  /** Checkpoint family this describes, as upstream names it. */
  readonly family: string;
  /** Maximum `criteria` entries in ONE `choice` question. */
  readonly maxChoiceOptions: number;
  /** Provenance of {@link maxChoiceOptions}. */
  readonly maxChoiceOptionsSource: CheckpointLimitSource;
  /**
   * Maximum questions in one request.
   *
   * `undefined` means UNKNOWN, and unknown is treated as "refuse to exceed the
   * conservative bound" rather than "assume the big one".
   */
  readonly maxQuestions?: number;
  readonly maxQuestionsSource?: CheckpointLimitSource;
  /** Human-readable note for the settings UI when a plan is refused. */
  readonly note?: string;
};

/**
 * Upstream's documented per-family `choice` ceilings.
 *
 * Only families upstream actually names appear here. julia-1, lev and kev are
 * absent on purpose: upstream publishes no number for them, and nothing in this
 * repository has measured one either. The runs in `docs/audits/` exercised
 * small option sets — they established what these models ANSWER, not how many
 * options they can be asked about — so writing 255 down for them would be a
 * number with no experiment behind it, presented as though it had one. They
 * resolve through {@link limitsForCheckpoint} to the conservative bound instead,
 * which is the correct answer for an unknown ceiling.
 *
 * `maxQuestions` is deliberately absent for every family: upstream publishes
 * none, and inventing a number would be the same category error as copying an
 * option ceiling between models.
 */
export const NATIVE_CHECKPOINT_LIMITS: readonly CheckpointLimits[] = [
  {
    family: 'openjev',
    maxChoiceOptions: 52,
    maxChoiceOptionsSource: 'upstream-documented',
    note: 'Upstream states 52 criteria keys for OpenJev.',
  },
  {
    family: 'laya',
    maxChoiceOptions: 255,
    maxChoiceOptionsSource: 'upstream-documented',
    note:
      'Upstream states 255 criteria keys for Laya. Upstream also notes Laya truncates ' +
      'long questions and options to the token budget the model was trained with, so a ' +
      'large question is silently shortened rather than rejected.',
  },
  {
    family: 'clef',
    maxChoiceOptions: 255,
    maxChoiceOptionsSource: 'upstream-documented',
    note: 'Upstream states 255 criteria keys for clef. Clef serves only this endpoint.',
  },
];

/**
 * Conservative ceiling applied when a checkpoint's own limit is not known.
 *
 * Deliberately the SMALLEST published ceiling rather than the largest: under
 * declaring refuses a plan that would have worked, which is recoverable and
 * visible. Over declaring sends a request upstream truncates or rejects, which
 * is neither.
 */
export const UNKNOWN_CHECKPOINT_MAX_CHOICE_OPTIONS = 52;

/** Normalises a checkpoint identity to its family, e.g. `Laya-Q8_0.gguf` -> `laya`. */
export const checkpointFamily = (checkpoint: string): string => {
  const base = checkpoint.trim().toLowerCase().split(/[/\\]/).pop() ?? '';
  const withoutQuant = base.replace(/\.(gguf|safetensors|bin)$/, '');
  // A filename like `Laya-Q8_0` or `laya_1_2b_q4_k_m` reduces to its stem.
  const stem = withoutQuant.replace(/[-_](q\d+(_[a-z0-9]+)*|f16|f32|bf16|iq\d.*)$/, '');
  return stem.replace(/[-_](gguf)$/, '').trim();
};

/** Resolves a checkpoint's limits, or the conservative unknown-checkpoint bound. */
export const limitsForCheckpoint = (checkpoint: string): CheckpointLimits => {
  const family = checkpointFamily(checkpoint);
  const known = NATIVE_CHECKPOINT_LIMITS.find((entry) => entry.family === family);
  if (known !== undefined) {
    return known;
  }
  return {
    family,
    maxChoiceOptions: UNKNOWN_CHECKPOINT_MAX_CHOICE_OPTIONS,
    maxChoiceOptionsSource: 'unknown-fallback',
    note:
      `Checkpoint family "${family}" is not one Aikami has verified. Its real ceiling is ` +
      `unknown, so the smallest published ceiling (${UNKNOWN_CHECKPOINT_MAX_CHOICE_OPTIONS}) ` +
      'is enforced. A plan needing more options is refused rather than truncated.',
  };
};

/**
 * A plan element that exceeds a checkpoint's real limit.
 *
 * Reported instead of corrected. Truncating an option list asks the model a
 * narrower question and then reconstructs from an answer to that narrower
 * question — the caller receives a value for a field it did not ask about.
 */
export type CheckpointLimitViolation = {
  readonly code: 'option-limit-exceeded' | 'question-limit-exceeded';
  /** Plan question key the violation belongs to. */
  readonly questionKey?: string;
  readonly detail: string;
};

/**
 * Fails closed when a dispatch unit exceeds its checkpoint's real limits.
 *
 * Returns every violation so a settings screen can show all of them at once
 * rather than one per attempt.
 */
export const checkCheckpointLimits = (options: {
  readonly checkpoint: string;
  readonly limits: CheckpointLimits;
  readonly questions: readonly { readonly key: string; readonly optionCount?: number }[];
}): readonly CheckpointLimitViolation[] => {
  const violations: CheckpointLimitViolation[] = [];
  const questionCeiling = options.limits.maxQuestions;
  if (questionCeiling !== undefined && options.questions.length > questionCeiling) {
    violations.push({
      code: 'question-limit-exceeded',
      detail:
        `unit carries ${options.questions.length} questions; checkpoint "${options.limits.family}" ` +
        `accepts at most ${questionCeiling}`,
    });
  }
  for (const question of options.questions) {
    if (question.optionCount === undefined) {
      continue;
    }
    if (question.optionCount > options.limits.maxChoiceOptions) {
      violations.push({
        code: 'option-limit-exceeded',
        questionKey: question.key,
        detail:
          `question "${question.key}" offers ${question.optionCount} options; checkpoint ` +
          `"${options.limits.family}" accepts at most ${options.limits.maxChoiceOptions} ` +
          `(${options.limits.maxChoiceOptionsSource}). Refusing rather than truncating, ` +
          'because a truncated option list asks a different question.',
      });
    }
  }
  return violations;
};

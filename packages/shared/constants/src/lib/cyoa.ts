// packages/shared/constants/src/lib/cyoa.ts
//
// CYOA (Choose Your Own Adventure) agent constants. Consumed by the
// CYOA agent, choice button UI, and choice history tracking.
//
// Contract: C-245 CYOA Choices Branching Narrative

/** Built-in agent ID for the CYOA post-processing agent. */
export const CYOA_AGENT_ID = 'cyoa';

/** Maximum number of choices the CYOA agent may propose per turn. */
export const CYOA_MAX_CHOICES = 4;

/** Minimum number of choices required to render the choice UI. */
export const CYOA_MIN_CHOICES = 2;

/** Maximum choice label length before truncation with ellipsis. */
export const CYOA_LABEL_MAX_LENGTH = 80;

/** Maximum number of history entries injected into the GM prompt. */
export const CYOA_HISTORY_CAP = 10;

/** Section heading used when injecting choice history into the GM prompt. */
export const CYOA_HISTORY_HEADING = '## Recent Choices';

/** Label shown when the agent returns exactly one choice (prompt-advance). */
export const CYOA_SINGLE_CHOICE_LABEL = 'Continue';

/** Toggle label for feeding CYOA choices into the impersonation draft. */
export const CYOA_AS_DIRECTION_LABEL = 'Use CYOA as direction';

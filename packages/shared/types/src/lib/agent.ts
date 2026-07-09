// packages/shared/types/src/lib/agent.ts
//
// Agent pipeline types shared across project boundaries.
// AgentPhase is consumed by both client-local types and shared constants.

/**
 * The execution phase of a pipeline agent.
 * - `pre`:  Runs before main generation, injects context into system prompt.
 * - `main`: The primary AI response generation stage.
 * - `post`: Runs after main generation, produces state patches.
 */
export type AgentPhase = 'pre' | 'main' | 'post';

// packages/shared/schemas/src/lib/swarm_handoff.ts
/**
 * Swarm agent handoff JSON sidecar schema (C-311).
 *
 * Replaces freeform markdown summaries with a structured, validated JSON format
 * that downstream agents can consume without parsing noisy conversational transcripts.
 */

import { type Static, Type } from 'typebox';

/** Agent roles in the swarm pipeline. */
export const SwarmRoleSchema = Type.Union([
  Type.Literal('architect'),
  Type.Literal('coder'),
  Type.Literal('qa'),
  Type.Literal('git'),
  Type.Literal('review'),
  Type.Literal('document'),
]);
export type SwarmRole = Static<typeof SwarmRoleSchema>;

/** Task completion status. */
export const SwarmStatusSchema = Type.Union([
  Type.Literal('success'),
  Type.Literal('failed'),
  Type.Literal('escalated'),
  Type.Literal('awaiting_approval'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('feedback'),
]);
export type SwarmStatus = Static<typeof SwarmStatusSchema>;

/** Task complexity tier */
export const SwarmComplexitySchema = Type.Union([
  Type.Literal('trivial'),
  Type.Literal('standard'),
  Type.Literal('complex'),
]);
export type SwarmComplexity = Static<typeof SwarmComplexitySchema>;

/** Work domain for dynamic skill injection. */
export const SwarmDomainSchema = Type.Union([
  Type.Literal('frontend'),
  Type.Literal('backend'),
  Type.Literal('fullstack'),
]);
export type SwarmDomain = Static<typeof SwarmDomainSchema>;

/**
 * Structured agent handoff payload.
 *
 * Written as .pi/swarm/outputs/<taskId>_<role>_handoff.json by each agent
 * upon completion of its step. Downstream agents read this file to seed
 * their context instead of reading raw verbose transcripts.
 */
export const SwarmHandoffSchema = Type.Object({
  /** Unique task identifier (e.g. "C-311") */
  taskId: Type.String(),
  /** Agent role that produced this handoff */
  role: SwarmRoleSchema,
  /** Whether the step completed successfully */
  status: SwarmStatusSchema,
  /** Task complexity — drives conditional routing (trivial → skip QA) */
  complexity: SwarmComplexitySchema,
  /** Which domain the work falls under — drives coder skill injection */
  domain: SwarmDomainSchema,
  /** Whether the task requires documentation agent */
  requiresDocs: Type.Boolean(),
  /** List of files created or modified */
  filesTouched: Type.Array(Type.String()),
  /** Shell commands for downstream agents to execute */
  nextCommands: Type.Array(Type.String()),
  /** Files scoped to the coder (from architect handoff) */
  coderFiles: Type.Optional(Type.Array(Type.String())),
  /** Files scoped to QA (from architect handoff) */
  qaFiles: Type.Optional(Type.Array(Type.String())),
  /** Human-readable summary, max 2048 chars */
  summary: Type.String({ maxLength: 2048 }),
});
export type SwarmHandoff = Static<typeof SwarmHandoffSchema>;

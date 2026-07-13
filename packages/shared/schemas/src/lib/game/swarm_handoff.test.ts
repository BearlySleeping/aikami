// packages/shared/schemas/src/lib/swarm_handoff.test.ts
/**
 * Validation tests for SwarmHandoffSchema (C-311).
 *
 * Run: bun test packages/shared/schemas/src/lib/swarm_handoff.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import { SwarmHandoffSchema } from './swarm_handoff';

describe('SwarmHandoffSchema', () => {
  const validHandoff = {
    taskId: 'C-311',
    role: 'architect',
    status: 'success',
    complexity: 'standard',
    domain: 'fullstack',
    requiresDocs: false,
    filesTouched: ['file1.ts', 'file2.ts'],
    nextCommands: ['moon run project:fix', 'moon run project:typecheck'],
    summary: 'Implemented feature X with tests',
  };

  test('should validate a valid architect handoff', () => {
    expect(Value.Check(SwarmHandoffSchema, validHandoff)).toBe(true);
  });

  test('should validate all valid roles', () => {
    for (const role of ['architect', 'coder', 'qa', 'git', 'document']) {
      const h = { ...validHandoff, role };
      expect(Value.Check(SwarmHandoffSchema, h)).toBe(true);
    }
  });

  test('should validate all valid statuses', () => {
    for (const status of ['success', 'failed', 'escalated']) {
      const h = { ...validHandoff, status };
      expect(Value.Check(SwarmHandoffSchema, h)).toBe(true);
    }
  });

  test('should validate all complexities', () => {
    for (const complexity of ['trivial', 'standard', 'complex']) {
      const h = { ...validHandoff, complexity };
      expect(Value.Check(SwarmHandoffSchema, h)).toBe(true);
    }
  });

  test('should reject invalid role', () => {
    const h = { ...validHandoff, role: 'invalid_role' };
    expect(Value.Check(SwarmHandoffSchema, h)).toBe(false);
  });

  test('should reject invalid status', () => {
    const h = { ...validHandoff, status: 'pending' };
    expect(Value.Check(SwarmHandoffSchema, h)).toBe(false);
  });

  test('should reject missing required fields', () => {
    const h = { taskId: 'C-311' };
    expect(Value.Check(SwarmHandoffSchema, h)).toBe(false);
  });

  test('should reject summary exceeding 2048 chars', () => {
    const h = { ...validHandoff, summary: 'x'.repeat(2049) };
    expect(Value.Check(SwarmHandoffSchema, h)).toBe(false);
  });

  test('should accept summary at exactly 2048 chars', () => {
    const h = { ...validHandoff, summary: 'x'.repeat(2048) };
    expect(Value.Check(SwarmHandoffSchema, h)).toBe(true);
  });

  test('should reject non-array filesTouched', () => {
    const h = { ...validHandoff, filesTouched: 'file1.ts' as unknown as string[] };
    expect(Value.Check(SwarmHandoffSchema, h)).toBe(false);
  });

  test('should validate coder handoff with failure', () => {
    const coderHandoff = {
      taskId: 'C-311',
      role: 'coder',
      status: 'failed',
      complexity: 'standard',
      domain: 'frontend',
      requiresDocs: false,
      filesTouched: ['src/app.ts'],
      nextCommands: [],
      summary: 'Typecheck failed after 3 attempts',
    };
    expect(Value.Check(SwarmHandoffSchema, coderHandoff)).toBe(true);
  });
});

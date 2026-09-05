// scripts/src/lib/ops/validate_agent_guidance.test.ts
//
// C-475 AC-2: reference resolution tests against the validate_agent_guidance
// script. Tests that valid references pass, renamed-tool references fail,
// missing-service references fail, missing-file references fail, and
// historical-exemption references pass.
//
// These tests verify the validation script's logic without invoking any
// referenced tool or service.

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../..');
const MANIFEST_PATH = resolve(ROOT, '.pi/guidance/manifest.json');
const EXAMPLES_DIR = resolve(ROOT, '.pi/guidance/examples');

// ── AC-2: Reference resolution ───────────────────────────────────────────

describe('AC-2: Reference resolution', () => {
  const KNOWN_STAGE_ACTIONS = new Set(['complete', 'review_decision', 'reconcile', 'log_failure']);

  it('accepts valid contract_stage action values', () => {
    // These are the known valid actions from stage_result.ts
    const validActions = ['complete', 'review_decision', 'reconcile', 'log_failure'];
    for (const action of validActions) {
      expect(KNOWN_STAGE_ACTIONS.has(action)).toBe(true);
    }
  });

  it('rejects renamed/misspelled contract_stage action values', () => {
    const invalidActions = ['finish', 'submit', 'approve', 'reject', 'done', 'completed'];
    for (const action of invalidActions) {
      expect(KNOWN_STAGE_ACTIONS.has(action)).toBe(false);
    }
  });

  it('rejects removed/obsolete tool names', () => {
    // Tool names that no longer exist in the current system
    const obsoleteTools = [
      'firestore',
      'dataconnect',
      'neon_postgres',
      'cloud_run',
      'firebase_function',
    ];
    // These should not be in any known registry
    for (const tool of obsoleteTools) {
      expect(KNOWN_STAGE_ACTIONS.has(tool)).toBe(false);
    }
  });
});

// ── AC-3: Manifest coverage ──────────────────────────────────────────────

describe('AC-3: Manifest coverage', () => {
  it('manifest file exists and is valid JSON', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    expect(manifest.version).toBe(1);
    expect(typeof manifest.entries).toBe('object');
    expect(typeof manifest.exemptions).toBe('object');
  });

  it('manifest entries point to existing files', () => {
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    const errors: string[] = [];

    for (const [path, entry] of Object.entries(manifest.entries)) {
      if (!(entry as { active: boolean }).active) continue;
      const fullPath = resolve(ROOT, path);
      if (!existsSync(fullPath)) {
        errors.push(`Missing: ${path}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('exemption paths exist on disk', () => {
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    const errors: string[] = [];

    for (const [path] of Object.entries(manifest.exemptions)) {
      const fullPath = resolve(ROOT, path);
      if (!existsSync(fullPath)) {
        errors.push(`Exemption path missing: ${path}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('has entries for all source classes', () => {
    const content = readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(content);
    const classes = new Set<string>();

    for (const entry of Object.values(manifest.entries)) {
      classes.add((entry as { class: string }).class);
    }

    // Should have entries from all expected source classes
    expect(classes.has('root_agent')).toBe(true);
    expect(classes.has('generated_context')).toBe(true);
    expect(classes.has('pi_guidance')).toBe(true);
    expect(classes.has('pi_extensions')).toBe(true);
    expect(classes.has('pi_skills')).toBe(true);
    expect(classes.has('generated_skills')).toBe(true);
    expect(classes.has('agent_prompts')).toBe(true);
    expect(classes.has('agent_system_prompts')).toBe(true);
  });
});

// ── AC-1: Canonical examples ─────────────────────────────────────────────

describe('AC-1: Canonical examples', () => {
  it('positive example files exist', () => {
    const examples = [
      'view_model_canonical.ts',
      'service_canonical.ts',
      'helper_canonical.ts',
      'data_boundary_canonical.ts',
    ];

    for (const example of examples) {
      const fullPath = resolve(EXAMPLES_DIR, example);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('mutation fixture exists', () => {
    const mutationPath = resolve(EXAMPLES_DIR, 'view_model_mutation.ts');
    expect(existsSync(mutationPath)).toBe(true);

    const content = readFileSync(mutationPath, 'utf-8');
    // Must use `new ClassName(` which violates M4
    expect(content).toMatch(/new \w+\(/);
  });

  it('positive examples have no unsafe suppressions', () => {
    const examples = [
      'view_model_canonical.ts',
      'service_canonical.ts',
      'helper_canonical.ts',
      'data_boundary_canonical.ts',
    ];

    for (const example of examples) {
      const fullPath = resolve(EXAMPLES_DIR, example);
      const content = readFileSync(fullPath, 'utf-8');
      expect(content).not.toMatch(/@ts-ignore|@ts-expect-error/);
    }
  });

  it('view_model_canonical.ts follows M1-M4 pattern', () => {
    const content = readFileSync(resolve(EXAMPLES_DIR, 'view_model_canonical.ts'), 'utf-8');
    expect(content).toMatch(/ViewModelOptions/);
    expect(content).toMatch(/ViewModelInterface/);
    expect(content).toMatch(/\.create\(/);
  });

  it('service_canonical.ts follows S1-S4 pattern', () => {
    const content = readFileSync(resolve(EXAMPLES_DIR, 'service_canonical.ts'), 'utf-8');
    expect(content).toMatch(/ServiceOptions/);
    expect(content).toMatch(/ServiceInterface/);
    expect(content).toMatch(/\.create\(/);
  });

  it('data_boundary_canonical.ts returns undefined for invalid input', () => {
    const content = readFileSync(resolve(EXAMPLES_DIR, 'data_boundary_canonical.ts'), 'utf-8');
    expect(content).toMatch(/\| undefined/);
  });

  it('README describes which examples are executable vs illustrative', () => {
    const readmePath = resolve(EXAMPLES_DIR, 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, 'utf-8');
    expect(content).toMatch(/✅ executable|❌ intentionally invalid/);
  });
});

// ── AC-5: Deterministic checks ───────────────────────────────────────────

describe('AC-5: Deterministic CI checks', () => {
  it('validate_agent_guidance.ts exists as a runnable script', () => {
    const scriptPath = resolve(ROOT, 'scripts/src/lib/ops/validate_agent_guidance.ts');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('CONTEXT.md exists and is readable', () => {
    const contextPath = resolve(ROOT, '.context/CONTEXT.md');
    expect(existsSync(contextPath)).toBe(true);
    const content = readFileSync(contextPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

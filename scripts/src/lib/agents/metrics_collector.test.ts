// scripts/src/lib/agents/metrics_collector.test.ts
/**
 * Unit tests for metrics_collector.ts (C-311).
 *
 * Verifies non-LLM telemetry computation — no external dependencies needed.
 * Run: bun test scripts/src/lib/agents/metrics_collector.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectTaskMetrics, writeMetrics } from './metrics_collector';

// ── Test setup ──────────────────────────────────────────────

const TEST_TASK_ID = 'C-TEST-METRICS';
const testOutputsDir = join(process.cwd(), '.pi', 'swarm', 'outputs');

const setupTestHandoffs = () => {
  mkdirSync(testOutputsDir, { recursive: true });

  writeFileSync(
    join(testOutputsDir, `${TEST_TASK_ID}_architect_handoff.json`),
    JSON.stringify({
      taskId: TEST_TASK_ID,
      role: 'architect',
      status: 'success',
      complexity: 'trivial',
      domain: 'frontend',
      requiresDocs: false,
      filesTouched: ['plan.md'],
      nextCommands: ['moon run utils:test'],
      summary: 'Trivial single-file change',
    }),
  );

  writeFileSync(
    join(testOutputsDir, `${TEST_TASK_ID}_coder_handoff.json`),
    JSON.stringify({
      taskId: TEST_TASK_ID,
      role: 'coder',
      status: 'success',
      complexity: 'trivial',
      domain: 'frontend',
      requiresDocs: false,
      filesTouched: ['utils.ts', 'utils.test.ts'],
      nextCommands: ['moon run utils:test'],
      summary: 'Added isSwarmReady function + test',
    }),
  );

  writeFileSync(
    join(testOutputsDir, `${TEST_TASK_ID}_git.md`),
    'Commit: feat(utils): add isSwarmReady function',
  );
};

const cleanup = () => {
  try {
    rmSync(join(testOutputsDir, `${TEST_TASK_ID}_architect_handoff.json`), { force: true });
    rmSync(join(testOutputsDir, `${TEST_TASK_ID}_coder_handoff.json`), { force: true });
    rmSync(join(testOutputsDir, `${TEST_TASK_ID}_git.md`), { force: true });
    rmSync(join(testOutputsDir, `${TEST_TASK_ID}_metrics.json`), { force: true });
  } catch {
    // Best-effort
  }
};

// ── Tests ──────────────────────────────────────────────────

describe('metrics_collector', () => {
  test('should collect metrics from handoff JSONs', () => {
    setupTestHandoffs();
    try {
      const startTime = Date.now() - 5000;
      const metrics = collectTaskMetrics({
        taskId: TEST_TASK_ID,
        startTime,
        trivialPath: true,
        documentationGenerated: false,
      });

      expect(metrics.taskId).toBe(TEST_TASK_ID);
      expect(metrics.trivialPath).toBe(true);
      expect(metrics.documentationGenerated).toBe(false);
      expect(metrics.totalDurationMs).toBeGreaterThanOrEqual(4000);

      const architect = metrics.agents.find((a) => a.role === 'architect');
      expect(architect).toBeDefined();
      expect(architect?.status).toBe('success');
      expect(architect?.filesTouched).toBe(1);

      const coder = metrics.agents.find((a) => a.role === 'coder');
      expect(coder).toBeDefined();
      expect(coder?.status).toBe('success');
      expect(coder?.filesTouched).toBe(2);

      const qa = metrics.agents.find((a) => a.role === 'qa');
      expect(qa).toBeDefined();
      expect(qa?.status).toBe('skipped');

      const git = metrics.agents.find((a) => a.role === 'git');
      expect(git).toBeDefined();
      expect(git?.status).toBe('unknown');
    } finally {
      cleanup();
    }
  });

  test('should write valid metrics JSON file', () => {
    setupTestHandoffs();
    try {
      const metrics = collectTaskMetrics({
        taskId: TEST_TASK_ID,
        startTime: Date.now() - 1000,
      });

      const path = writeMetrics(TEST_TASK_ID, metrics);
      expect(path).toContain(`${TEST_TASK_ID}_metrics.json`);

      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw);

      expect(parsed.taskId).toBe(TEST_TASK_ID);
      expect(Array.isArray(parsed.agents)).toBe(true);
      expect(parsed.agents.length).toBe(5);
    } finally {
      cleanup();
    }
  });

  test('should handle missing handoffs gracefully (all unknown)', () => {
    const metrics = collectTaskMetrics({
      taskId: 'NON_EXISTENT_TASK',
      startTime: Date.now() - 1000,
    });

    expect(metrics.taskId).toBe('NON_EXISTENT_TASK');
    expect(metrics.trivialPath).toBe(false);
    for (const agent of metrics.agents) {
      expect(agent.status).toBe('unknown');
      expect(agent.summaryPreview).toBe('(no output)');
    }
  });

  test('should mark QA as skipped on trivial path even with legacy .md present', () => {
    // Simulate scenario where QA was skipped but old .md file exists
    const legacyQaPath = join(testOutputsDir, `${TEST_TASK_ID}_qa.md`);
    mkdirSync(testOutputsDir, { recursive: true });
    writeFileSync(legacyQaPath, 'Old QA summary from previous run');

    try {
      const metrics = collectTaskMetrics({
        taskId: TEST_TASK_ID,
        startTime: Date.now() - 1000,
        trivialPath: true,
      });

      const qa = metrics.agents.find((a) => a.role === 'qa');
      expect(qa).toBeDefined();
      expect(qa?.status).toBe('skipped');
      expect(qa?.summaryPreview).toBe('(skipped — trivial path)');
    } finally {
      try {
        rmSync(legacyQaPath, { force: true });
      } catch {
        /* cleanup */
      }
    }
  });
});

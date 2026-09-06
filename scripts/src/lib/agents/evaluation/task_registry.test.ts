// scripts/src/lib/agents/evaluation/task_registry.test.ts
//
// C-480 AC-1: tasks have independent, frozen acceptance checks — hashes
// are stable for an unchanged task and change when the task changes;
// a held-out subset exists.

import { describe, expect, it } from 'bun:test';
import {
  computeTaskHashes,
  getTask,
  listHeldOutTasks,
  listTasks,
  listVisibleTasks,
} from './task_registry.ts';
import type { CatalogueEntry, EvalConfig } from './types.ts';

const CATALOGUE: CatalogueEntry = {
  family: 'flash',
  provider: 'deepinfra',
  model: 'deepseek-ai/DeepSeek-V4-Flash',
  available: true,
};

const CONFIG: EvalConfig = {
  id: 'flash-high',
  family: 'flash',
  catalogue: CATALOGUE,
  thinking: 'high',
  cacheCondition: 'cold',
};

describe('AC-1: frozen task registry', () => {
  it('registers at least 8 tasks spanning every required category', () => {
    const categories = new Set(listTasks().map((t) => t.category));
    expect(listTasks().length).toBeGreaterThanOrEqual(8);
    expect(categories).toEqual(
      new Set([
        'instruction_repair',
        'pure_typescript',
        'validation_error_handling',
        'process_concurrency',
        'svelte_reactivity',
        'cross_platform_scripting',
      ]),
    );
  });

  it('has a non-empty held-out subset excluded from visible tasks', () => {
    expect(listHeldOutTasks().length).toBeGreaterThan(0);
    for (const task of listHeldOutTasks()) {
      expect(listVisibleTasks().find((t) => t.id === task.id)).toBeUndefined();
    }
  });

  it('getTask resolves a known id and returns undefined for an unknown one', () => {
    expect(getTask('pure_typescript_v1')?.id).toBe('pure_typescript_v1');
    expect(getTask('does-not-exist')).toBeUndefined();
  });

  it('computeTaskHashes is stable for the same task/config and differs across configs', () => {
    const task = getTask('pure_typescript_v1');
    if (!task) {
      throw new Error('fixture task missing');
    }
    const a = computeTaskHashes({ task, config: CONFIG });
    const b = computeTaskHashes({ task, config: CONFIG });
    expect(a).toEqual(b);

    const otherConfig: EvalConfig = { ...CONFIG, id: 'sonnet-high', thinking: 'medium' };
    const c = computeTaskHashes({ task, config: otherConfig });
    expect(c.configHash).not.toBe(a.configHash);
    expect(c.taskHash).toBe(a.taskHash);
    expect(c.baseHash).toBe(a.baseHash);
    expect(c.acceptanceHash).toBe(a.acceptanceHash);
  });

  it('different tasks produce different task/base/acceptance hashes', () => {
    const a = getTask('pure_typescript_v1');
    const b = getTask('validation_error_handling_v1');
    if (!(a && b)) {
      throw new Error('fixture tasks missing');
    }
    const hashesA = computeTaskHashes({ task: a, config: CONFIG });
    const hashesB = computeTaskHashes({ task: b, config: CONFIG });
    expect(hashesA.taskHash).not.toBe(hashesB.taskHash);
    expect(hashesA.baseHash).not.toBe(hashesB.baseHash);
    expect(hashesA.acceptanceHash).not.toBe(hashesB.acceptanceHash);
  });

  it('changes acceptanceHash when a closed-over acceptance dependency changes', () => {
    const task = getTask('process_concurrency_v1');
    if (!task) {
      throw new Error('fixture task missing');
    }
    const original = computeTaskHashes({ task, config: CONFIG });
    const changedDependency = {
      ...task,
      acceptanceDependencies: [...(task.acceptanceDependencies ?? []), 'changed-helper-source'],
    };
    const changed = computeTaskHashes({ task: changedDependency, config: CONFIG });
    expect(changed.acceptanceHash).not.toBe(original.acceptanceHash);
  });
});

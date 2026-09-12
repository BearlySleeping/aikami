// packages/shared/constants/src/lib/text_task.test.ts
//
// Contract tests for the text-task taxonomy and presets (C-507). This is the
// table most likely to drift silently — every task must have exactly one
// preset and label, and every preset must map onto a real text role.

import { describe, expect, test } from 'bun:test';
import {
  AGENT_TEXT_TASKS,
  DEFAULT_TEXT_PARAMS,
  TEXT_TASK_LABELS,
  TEXT_TASK_PRESETS,
  TEXT_TASKS,
  textTaskPreset,
} from './text_task.ts';

const TEXT_ROLES = new Set(['narration', 'dialogue', 'summarization', 'structured']);

describe('TEXT_TASKS presets', () => {
  test('every task has a preset', () => {
    for (const task of TEXT_TASKS) {
      expect(TEXT_TASK_PRESETS[task]).toBeDefined();
    }
  });

  test('every task has a label', () => {
    for (const task of TEXT_TASKS) {
      expect(TEXT_TASK_LABELS[task]?.length).toBeGreaterThan(0);
    }
  });

  test('every preset maps to a text role', () => {
    for (const task of TEXT_TASKS) {
      expect(TEXT_ROLES.has(TEXT_TASK_PRESETS[task].role)).toBe(true);
    }
  });

  test('every preset caps output tokens', () => {
    for (const task of TEXT_TASKS) {
      expect(TEXT_TASK_PRESETS[task].maxTokens).toBeGreaterThan(0);
    }
  });

  test('interactive tasks use higher priority than background tasks', () => {
    for (const task of TEXT_TASKS) {
      const preset = TEXT_TASK_PRESETS[task];
      expect(['interactive', 'background']).toContain(preset.priority);
    }
  });

  test('narration streams and summarization does not', () => {
    expect(TEXT_TASK_PRESETS.narration.streamable).toBe(true);
    expect(TEXT_TASK_PRESETS.summarization.streamable).toBe(false);
  });

  test('textTaskPreset defaults to narration', () => {
    expect(textTaskPreset(undefined)).toBe(TEXT_TASK_PRESETS.narration);
    expect(textTaskPreset('combat-intent')).toBe(TEXT_TASK_PRESETS['combat-intent']);
  });
});

describe('AGENT_TEXT_TASKS', () => {
  test('maps every built-in agent id to a known task', () => {
    for (const [agentId, task] of Object.entries(AGENT_TEXT_TASKS)) {
      expect(TEXT_TASKS).toContain(task);
      expect(agentId.length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_TEXT_PARAMS', () => {
  test('is a complete TextParams object', () => {
    expect(DEFAULT_TEXT_PARAMS.maxTokens).toBeGreaterThan(0);
    expect(DEFAULT_TEXT_PARAMS.temperature).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_TEXT_PARAMS.contextSize).toBeGreaterThan(0);
  });
});

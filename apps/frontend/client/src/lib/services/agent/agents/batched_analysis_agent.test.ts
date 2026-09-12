// apps/frontend/client/src/lib/services/agent/agents/batched_analysis_agent.test.ts
//
// Contract tests for the combined post-agent analysis call (C-507). Exercises
// the pure schema/split helpers so no LLM or service mock is needed.

import { describe, expect, test } from 'bun:test';
import {
  buildBatchedPrompt,
  buildCombinedSchema,
  isBatchableAgent,
  splitBatchedOutput,
} from './batched_analysis_agent.ts';

describe('isBatchableAgent', () => {
  test('classifies batchable and non-batchable agents', () => {
    expect(isBatchableAgent('world-state')).toBe(true);
    expect(isBatchableAgent('cyoa')).toBe(true);
    expect(isBatchableAgent('music-dj')).toBe(false);
    expect(isBatchableAgent('narrative-director')).toBe(false);
  });
});

describe('buildCombinedSchema', () => {
  test('includes only the requested sections', () => {
    const schema = buildCombinedSchema(['world-state', 'cyoa']) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual(['choices', 'worldState']);
    expect(schema.required.sort()).toEqual(['choices', 'worldState']);
  });

  test('ignores unknown agent ids', () => {
    const schema = buildCombinedSchema(['not-an-agent']) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toHaveLength(0);
  });

  test('buildBatchedPrompt lists requested sections', () => {
    const prompt = buildBatchedPrompt({ agentIds: ['cyoa'], aiResponse: 'The door creaks open.' });
    expect(prompt).toContain('"choices"');
    expect(prompt).toContain('The door creaks open.');
  });
});

describe('splitBatchedOutput', () => {
  test('restores world-state output verbatim', () => {
    const worldState = {
      locationName: 'Keep',
      locationDescription: 'A cold hall',
      timeOfDay: 'dusk',
      weather: 'rain',
      notableChanges: ['door opened'],
    };
    const split = splitBatchedOutput({
      agentIds: ['world-state'],
      raw: { worldState },
    });
    expect(split.get('world-state')).toEqual({ success: true, output: worldState });
  });

  test('fails a section that is absent', () => {
    const split = splitBatchedOutput({ agentIds: ['world-state'], raw: {} });
    expect(split.get('world-state')?.success).toBe(false);
  });

  test('defaults quest arrays and wraps cyoa choices', () => {
    const split = splitBatchedOutput({
      agentIds: ['quest-tracker', 'cyoa'],
      raw: { choices: [{ id: 'a', label: 'Open the door' }] },
    });
    expect(split.get('quest-tracker')).toEqual({
      success: true,
      output: { questUpdates: [], newQuests: [] },
    });
    expect(split.get('cyoa')).toEqual({
      success: true,
      output: { type: 'cyoa_choices', choices: [{ id: 'a', label: 'Open the door' }] },
    });
  });

  test('sanitizes duplicate and malformed choices', () => {
    const split = splitBatchedOutput({
      agentIds: ['cyoa'],
      raw: {
        choices: [
          { id: '1', label: 'Attack' },
          { id: '2', label: 'attack' },
          { id: '3', label: '   ' },
          { id: '4', label: 'Defend', skillCheck: { ability: 'dex', dc: 0 } },
        ],
      },
    });
    const output = split.get('cyoa')?.output as { choices: Array<{ label: string }> };
    expect(output.choices.map((choice) => choice.label)).toEqual(['Attack', 'Defend']);
  });

  test('normalizes expression characters array', () => {
    const split = splitBatchedOutput({
      agentIds: ['expression'],
      raw: { characters: [{ name: 'Elara', expression: 'happy' }] },
    });
    expect(split.get('expression')?.output).toEqual({
      characters: [{ name: 'Elara', expression: 'happy' }],
    });
  });
});

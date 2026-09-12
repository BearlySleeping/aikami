// apps/frontend/client/src/lib/views/settings/ai/ai_activity_view_model.test.ts
//
// Unit tests for the AI Activity ViewModel. Builds the VM from typed doubles —
// no service singletons, no module mocks.

import { describe, expect, mock, test } from 'bun:test';
import type { AiConnection, RoleAssignments } from '@aikami/types';
import type { TextTelemetrySpan } from '$types';
import { createAiActivityViewModel } from './ai_activity_view_model.svelte';

const makeConnection = (overrides: Partial<AiConnection>): AiConnection => ({
  id: 'conn-1',
  providerId: 'prov-1',
  capability: 'text',
  label: 'Fast local',
  model: 'qwen3',
  params: {
    temperature: 0.3,
    topP: 0.9,
    topK: 40,
    repetitionPenalty: 1.1,
    presencePenalty: 0,
    maxTokens: 512,
    contextSize: 4096,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const span: TextTelemetrySpan = {
  id: 1,
  task: 'narration',
  provider: 'openrouter',
  model: 'test/model',
  mode: 'byok',
  streamed: true,
  totalMs: 120,
  promptTokens: 10,
  completionTokens: 20,
  startedAt: '2026-01-01T00:00:00.000Z',
  ok: true,
};

const build = (options?: { assignments?: RoleAssignments; spans?: TextTelemetrySpan[] }) => {
  const clear = mock(() => {});
  const viewModel = createAiActivityViewModel({
    className: 'AiActivityViewModel',
    config: {
      getAiConnections: () => [makeConnection({})],
      getRoleAssignments: () => options?.assignments ?? {},
    },
    telemetry: {
      spans: options?.spans ?? [],
      summary: { count: 1, medianTotalMs: 120, totalTokens: 30, errorCount: 0 },
      clear,
    },
  });
  return { viewModel, clear };
};

describe('AiActivityViewModel', () => {
  test('projects every task onto its assigned role connection', () => {
    const { viewModel } = build({ assignments: { structured: 'conn-1' } });
    const rows = viewModel.taskRoutingRows;

    const structuredRow = rows.find((row) => row.task === 'combat-intent');
    expect(structuredRow?.role).toBe('structured');
    expect(structuredRow?.connectionLabel).toBe('Fast local');

    const narrationRow = rows.find((row) => row.task === 'narration');
    expect(narrationRow?.connectionLabel).toBe('Inherits default');
  });

  test('exposes the telemetry buffer and summary', () => {
    const { viewModel } = build({ spans: [span] });
    expect(viewModel.activitySpans).toHaveLength(1);
    expect(viewModel.activitySummary.totalTokens).toBe(30);
  });

  test('clearActivity delegates to the telemetry capability', () => {
    const { viewModel, clear } = build();
    viewModel.clearActivity();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

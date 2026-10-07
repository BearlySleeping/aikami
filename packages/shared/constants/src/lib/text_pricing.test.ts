// packages/shared/constants/src/lib/text_pricing.test.ts
//
// Pricing provenance and per-task budgets (issue #382 P0 instrumentation).
//
// The contract these tests protect is deliberately conservative: a figure is
// either derived from a versioned rate table, or it is absent. Nothing here
// may ever synthesise a cost for a model it does not have a rate for.

import { describe, expect, test } from 'bun:test';
import {
  estimateTextCostUsd,
  isLocalTextRoute,
  TEXT_PRICING_VERSION,
  type TextModelPricing,
  textTaskBudgetMs,
  textTaskPriority,
} from './text_pricing.ts';
import { TEXT_TASKS } from './text_task.ts';

const table: Readonly<Record<string, TextModelPricing>> = {
  'priced/model': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'cached/model': {
    inputPerMillionUsd: 10,
    outputPerMillionUsd: 30,
    cachedInputPerMillionUsd: 1,
  },
};

describe('estimateTextCostUsd', () => {
  test('prices a known model from the supplied table', () => {
    const estimate = estimateTextCostUsd({
      provider: 'openrouter',
      model: 'priced/model',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      table,
    });

    expect(estimate.usd).toBe(18);
    expect(estimate.source).toBe('priced');
    expect(estimate.pricingVersion).toBe(TEXT_PRICING_VERSION);
  });

  test('leaves an unknown model uncosted rather than guessing', () => {
    const estimate = estimateTextCostUsd({
      provider: 'openrouter',
      model: 'brand-new/model',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      table,
    });

    expect(estimate.usd).toBeUndefined();
    expect(estimate.source).toBe('unknown');
    expect(estimate.pricingVersion).toBeUndefined();
  });

  test.each(['ollama', 'local-tasks'])(
    '%s is a free local route for unlisted models',
    (provider) => {
      expect(isLocalTextRoute(provider)).toBe(true);
      expect(
        estimateTextCostUsd({ provider, model: 'unlisted', inputTokens: 1_000, outputTokens: 100 })
          .usd,
      ).toBe(0);
    },
  );

  test('local-prefixed cloud providers use normal model pricing', () => {
    expect(
      estimateTextCostUsd({
        provider: 'localai-cloud',
        model: 'priced/model',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        table,
      }).usd,
    ).toBe(18);
    expect(
      estimateTextCostUsd({
        provider: 'localai-cloud',
        model: 'unlisted',
        inputTokens: 1,
        outputTokens: 1,
      }).usd,
    ).toBeUndefined();
  });

  test('a local route costs nothing regardless of the model id', () => {
    const estimate = estimateTextCostUsd({
      provider: 'local-qwen3',
      model: 'unlisted-sidecar-model',
      inputTokens: 500_000,
      outputTokens: 500_000,
      table,
    });

    expect(estimate.usd).toBe(0);
    expect(estimate.source).toBe('local');
  });

  test('charges the discounted rate for provider-cached input tokens', () => {
    const estimate = estimateTextCostUsd({
      provider: 'openai',
      model: 'cached/model',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 800_000,
      table,
    });

    // 200k uncached × $10/M = $2, plus 800k cached × $1/M = $0.80.
    expect(estimate.usd).toBeCloseTo(2.8, 6);
  });

  test('falls back to the full input rate when a provider prices no cache rate', () => {
    const estimate = estimateTextCostUsd({
      provider: 'openai',
      model: 'priced/model',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedTokens: 1_000_000,
      table,
    });

    expect(estimate.usd).toBe(3);
  });

  test('clamps a cached-token count that exceeds the input count', () => {
    const estimate = estimateTextCostUsd({
      provider: 'openai',
      model: 'cached/model',
      inputTokens: 100,
      outputTokens: 0,
      cachedTokens: 9_999,
      table,
    });

    expect(estimate.usd).toBeCloseTo(0.0001, 8);
  });

  test('matches model ids case-insensitively', () => {
    const estimate = estimateTextCostUsd({
      provider: 'openrouter',
      model: 'Priced/Model',
      inputTokens: 1_000_000,
      outputTokens: 0,
      table,
    });

    expect(estimate.usd).toBe(3);
  });
});

describe('isLocalTextRoute', () => {
  test('classifies on-device providers as local', () => {
    expect(isLocalTextRoute('local-qwen3')).toBe(true);
    expect(isLocalTextRoute('llamacpp')).toBe(true);
    expect(isLocalTextRoute('OpenRouter')).toBe(false);
  });
});

describe('textTaskBudgetMs', () => {
  test('gives latency-sensitive combat tasks an end-to-end budget', () => {
    expect(textTaskBudgetMs('combat-ai')).toBe(4_000);
    expect(textTaskBudgetMs('combat-intent')).toBe(4_000);
    expect(textTaskBudgetMs('combat-narration')).toBe(4_000);
    expect(textTaskBudgetMs('envelope')).toBe(6_000);
  });

  test('leaves background work unbounded', () => {
    expect(textTaskBudgetMs('agent-schedule')).toBeUndefined();
    expect(textTaskBudgetMs('summarization')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// textTaskPriority — the admission classification (#382)
//
// PINNED deliberately. #416 measured that ONE background summarization degrades
// dialogue TTFT from 4 796 ms to 21 449 ms, so moving a task between the two
// classes is a player-visible latency change. It would not show up in any other
// test, would not fail any typecheck, and would be invisible in review unless
// it is written down here.
// ---------------------------------------------------------------------------

describe('textTaskPriority — inference admission classification', () => {
  test('the interactive set is exactly the player-visible path', () => {
    const interactive = TEXT_TASKS.filter((task) => textTaskPriority(task) === 'interactive');
    expect([...interactive].sort()).toEqual([
      'combat-ai',
      'combat-intent',
      'combat-narration',
      'dialogue',
      'envelope',
      'narration',
      'persona-create',
    ]);
  });

  test('the background set is exactly the best-effort work', () => {
    const background = TEXT_TASKS.filter((task) => textTaskPriority(task) === 'background');
    expect([...background].sort()).toEqual([
      'agent-batch',
      'agent-battle-trigger',
      'agent-custom',
      'agent-cyoa',
      'agent-expression',
      'agent-music',
      'agent-prose',
      'agent-quest',
      'agent-relationship',
      'agent-schedule',
      'agent-world',
      'summarization',
    ]);
  });

  test('an UNTASKED call is interactive, not background', () => {
    // An absent classification is not evidence the work is safe to delay.
    // Deferring an unknown call behind summarization would degrade the game on
    // a guess, and the guess has no author to correct it.
    expect(textTaskPriority(undefined)).toBe('interactive');
  });

  test('every task is classified — none can slip through unclassified', () => {
    for (const task of TEXT_TASKS) {
      expect(['interactive', 'background']).toContain(textTaskPriority(task));
    }
  });
});

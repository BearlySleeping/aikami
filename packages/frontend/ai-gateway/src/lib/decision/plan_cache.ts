// packages/frontend/ai-gateway/src/lib/decision/plan_cache.ts
//
// Bounded, content-keyed plan cache (issue #381, contract C-566).
//
// Keyed by schema CONTENT, compiler version and semantic metadata — never by
// schema name or object identity. Two call sites that inline the same shape
// share a plan; editing one option in a shared schema invalidates every plan
// that contains it, without anyone remembering to bump a version.

import { analyzeDecisionSchema, DECISION_COMPILER_VERSION } from './analyzer.ts';
import { bindDecisionPolicy } from './policy.ts';
import type {
  DecisionAnalysis,
  DecisionBinding,
  DecisionLanguage,
  DecisionLimits,
  DecisionPlan,
  DecisionTaskPolicy,
} from './types.ts';
import { stableStringify } from './util.ts';

/** Default bound. A plan is small; the cache exists to avoid recompiling, not to hold state. */
const DEFAULT_MAX_ENTRIES = 64;

/** The cache surface returned by {@link createDecisionPlanCache}. */
export type DecisionPlanCache = {
  /** Compiles a plan, reusing a cached entry when nothing relevant changed. */
  analyze(options: { schema: unknown; limits?: Partial<DecisionLimits> }): {
    readonly analysis: DecisionAnalysis;
    readonly cacheHit: boolean;
  };
  /** Binds task semantics to an already-compiled plan. */
  bind(options: {
    plan: DecisionPlan;
    policy: DecisionTaskPolicy;
    supportedLanguages?: readonly DecisionLanguage[];
  }): DecisionBinding;
  /** Current entry count. */
  readonly size: number;
};

/** Builds the structural cache key. */
const analysisKey = (schema: unknown, limits?: Partial<DecisionLimits>): string =>
  stableStringify({ compiler: DECISION_COMPILER_VERSION, schema, limits: limits ?? null });

/** Builds the semantic cache key. */
const bindingKey = (
  plan: DecisionPlan,
  policy: DecisionTaskPolicy,
  supportedLanguages?: readonly DecisionLanguage[],
): string =>
  stableStringify({
    plan: plan.schemaFingerprint,
    policy,
    supportedLanguages: supportedLanguages ?? null,
  });

/**
 * Creates a bounded plan cache with least-recently-used eviction.
 *
 * Successful analyses are cached; failures are not. A rejected schema is cheap
 * to re-evaluate and caching rejections would let a stale verdict outlive the
 * schema edit that would have fixed it.
 */
export const createDecisionPlanCache = (options?: { maxEntries?: number }): DecisionPlanCache => {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const analyses = new Map<string, DecisionAnalysis>();
  const bindings = new Map<string, DecisionBinding>();

  const touch = <T>(store: Map<string, T>, key: string, value: T): void => {
    store.delete(key);
    store.set(key, value);
    while (store.size > maxEntries) {
      const oldest = store.keys().next();
      if (oldest.done) {
        break;
      }
      store.delete(oldest.value);
    }
  };

  return {
    analyze({ schema, limits }): {
      readonly analysis: DecisionAnalysis;
      readonly cacheHit: boolean;
    } {
      const key = analysisKey(schema, limits);
      const cached = analyses.get(key);
      if (cached !== undefined) {
        touch(analyses, key, cached);
        return { analysis: cached, cacheHit: true };
      }
      const analysis = analyzeDecisionSchema({ schema, limits });
      if (analysis.ok) {
        touch(analyses, key, analysis);
      }
      return { analysis, cacheHit: false };
    },
    bind({ plan, policy, supportedLanguages }): DecisionBinding {
      const key = bindingKey(plan, policy, supportedLanguages);
      const cached = bindings.get(key);
      if (cached !== undefined) {
        touch(bindings, key, cached);
        return cached;
      }
      const binding = bindDecisionPolicy({ plan, policy, supportedLanguages });
      if (binding.ok) {
        touch(bindings, key, binding);
      }
      return binding;
    },
    get size(): number {
      return analyses.size + bindings.size;
    },
  };
};

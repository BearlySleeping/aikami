// packages/shared/schemas/src/lib/generation/asset_brief.test.ts
//
// C-519 AC-1 (schema level): the authored Emberwatch brief must validate
// against the TypeBox implementation of the shipped JSON Schema, and the
// validation must be *strict* — an unknown field, a missing required field or
// an unsupported policy value is rejected before the runner can touch an
// engine, a model or the staging tree.
//
// Contract: C-519 Durable asset jobs and batch execution

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Value } from 'typebox/value';
import { AssetBriefSchema } from './asset_brief.ts';

/** Repo root — this file lives at packages/shared/schemas/src/lib/generation. */
const REPO_ROOT = join(import.meta.dir, '../../../../../..');

type SchemaError = { keyword: string; path: string; message: string };

const errorsFor = (value: unknown): readonly SchemaError[] =>
  [...Value.Errors(AssetBriefSchema, value)].map((error) => ({
    keyword: String(error.keyword),
    path: error.instancePath || '/',
    message: String(error.message),
  }));

const readAuthoredBrief = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, 'docs/plans/emberwatch_asset_brief.json'), 'utf8'),
  ) as Record<string, unknown>;

describe('C-519 AC-1: the authored brief validates strictly', () => {
  test('the shipped Emberwatch brief validates against the TypeBox schema', () => {
    expect(errorsFor(readAuthoredBrief())).toEqual([]);
  });

  test('the brief reports the phase counts the plan is asserted against', () => {
    const parsed = Value.Parse(AssetBriefSchema, readAuthoredBrief());
    expect(parsed.summary.sliceItems).toBe(6);
    expect(parsed.summary.expansionItems).toBe(36);
    expect(parsed.summary.totalItems).toBe(42);
    expect(parsed.jobs.length).toBe(42);
    expect(parsed.execution.candidateLimitPerItem).toBe(2);
    expect(parsed.execution.hostedBudgetUsd).toBe(0);
  });

  test('an unknown top-level field is rejected (additionalProperties: false)', () => {
    const brief = { ...readAuthoredBrief(), sneakyPhase: 'expansion' };
    expect(Value.Check(AssetBriefSchema, brief)).toBe(false);
    expect(errorsFor(brief).some((error) => error.path === '/sneakyPhase')).toBe(true);
  });

  test('an unknown nested job field is rejected', () => {
    const brief = readAuthoredBrief();
    const jobs = (brief.jobs as readonly Record<string, unknown>[]).map((job, index) =>
      index === 0 ? { ...job, autoAccept: true } : job,
    );
    const mutated = { ...brief, jobs };
    expect(Value.Check(AssetBriefSchema, mutated)).toBe(false);
    expect(errorsFor(mutated).some((error) => error.path === '/jobs/0/autoAccept')).toBe(true);
  });

  test('a missing required field is rejected', () => {
    const { summary, ...withoutSummary } = readAuthoredBrief();
    expect(summary).toBeDefined();
    expect(Value.Check(AssetBriefSchema, withoutSummary)).toBe(false);
    expect(errorsFor(withoutSummary).some((error) => error.keyword === 'required')).toBe(true);
  });

  test('an unsupported provider fallback policy is rejected', () => {
    const brief = readAuthoredBrief();
    const execution = {
      ...(brief.execution as Record<string, unknown>),
      providerFallbackPolicy: 'any',
    };
    const mutated = { ...brief, execution };
    expect(Value.Check(AssetBriefSchema, mutated)).toBe(false);
    expect(
      errorsFor(mutated).some((error) => error.path === '/execution/providerFallbackPolicy'),
    ).toBe(true);
  });

  test('an unresolved reference hash must be an explicit null or a real SHA-256', () => {
    const brief = readAuthoredBrief();
    const references = (brief.references as readonly Record<string, unknown>[]).map((reference) =>
      reference.id === 'approved_style' ? { ...reference, sha256: 'not-a-hash' } : reference,
    );
    // A fabricated/garbled hash is rejected …
    expect(Value.Check(AssetBriefSchema, { ...brief, references })).toBe(false);
    // … while the authored explicit null (not yet resolved) is accepted.
    expect(Value.Check(AssetBriefSchema, readAuthoredBrief())).toBe(true);
  });

  test('a job candidate limit above the brief ceiling is rejected', () => {
    const brief = readAuthoredBrief();
    const jobs = (brief.jobs as readonly Record<string, unknown>[]).map((job, index) =>
      index === 0 ? { ...job, candidateLimit: 3 } : job,
    );
    const mutated = { ...brief, jobs };
    expect(Value.Check(AssetBriefSchema, mutated)).toBe(false);
    expect(errorsFor(mutated).some((error) => error.path === '/jobs/0/candidateLimit')).toBe(true);
  });

  test('brief and job ids stay within their derived run, job and request-key bounds', () => {
    const brief = readAuthoredBrief();
    const jobs = brief.jobs as readonly Record<string, unknown>[];
    expect(Value.Check(AssetBriefSchema, { ...brief, id: `b${'a'.repeat(134)}` })).toBe(true);
    expect(Value.Check(AssetBriefSchema, { ...brief, id: `b${'a'.repeat(135)}` })).toBe(false);
    expect(
      Value.Check(AssetBriefSchema, {
        ...brief,
        jobs: [{ ...jobs[0], id: `j${'a'.repeat(147)}` }, ...jobs.slice(1)],
      }),
    ).toBe(true);
    expect(
      Value.Check(AssetBriefSchema, {
        ...brief,
        jobs: [{ ...jobs[0], id: `j${'a'.repeat(148)}` }, ...jobs.slice(1)],
      }),
    ).toBe(false);
  });
});

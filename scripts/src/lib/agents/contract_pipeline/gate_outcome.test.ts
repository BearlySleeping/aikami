// scripts/src/lib/agents/contract_pipeline/gate_outcome.test.ts
import { describe, expect, it } from 'bun:test';
import {
  authorizationCovers,
  isFailingOutcome,
  isInconclusiveOutcome,
  isPassingOutcome,
  type PublicationAuthorization,
} from './gate_outcome.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

const authorization = (
  overrides: Partial<PublicationAuthorization> = {},
): PublicationAuthorization => ({
  outcome: 'failed',
  revision: HEAD,
  grantedBy: 'user',
  grantedAt: '2026-09-16T00:00:00Z',
  ...overrides,
});

describe('outcome predicates', () => {
  it('treats only passed as passing', () => {
    expect(isPassingOutcome('passed')).toBe(true);
    expect(isPassingOutcome('failed')).toBe(false);
    expect(isPassingOutcome('unavailable')).toBe(false);
    expect(isPassingOutcome('cancelled')).toBe(false);
  });

  it('treats only failed as failing', () => {
    expect(isFailingOutcome('failed')).toBe(true);
    expect(isFailingOutcome('unavailable')).toBe(false);
    expect(isFailingOutcome('cancelled')).toBe(false);
    expect(isFailingOutcome('passed')).toBe(false);
  });

  it('treats unavailable and cancelled as inconclusive — never green', () => {
    expect(isInconclusiveOutcome('unavailable')).toBe(true);
    expect(isInconclusiveOutcome('cancelled')).toBe(true);
    expect(isInconclusiveOutcome('passed')).toBe(false);
    expect(isInconclusiveOutcome('failed')).toBe(false);
  });
});

describe('authorizationCovers', () => {
  it('covers an exact outcome + revision match', () => {
    expect(
      authorizationCovers({ authorization: authorization(), outcome: 'failed', revision: HEAD }),
    ).toBe(true);
  });

  it('does not cover a different revision (the commit moved)', () => {
    expect(
      authorizationCovers({ authorization: authorization(), outcome: 'failed', revision: OLDER }),
    ).toBe(false);
  });

  it('does not cover a different outcome', () => {
    expect(
      authorizationCovers({
        authorization: authorization({ outcome: 'unavailable' }),
        outcome: 'failed',
        revision: HEAD,
      }),
    ).toBe(false);
  });

  it('never covers a passed outcome', () => {
    expect(
      authorizationCovers({ authorization: authorization(), outcome: 'passed', revision: HEAD }),
    ).toBe(false);
  });

  it('is false when no authorization is present', () => {
    expect(
      authorizationCovers({ authorization: undefined, outcome: 'failed', revision: HEAD }),
    ).toBe(false);
  });
});

// scripts/src/lib/catalog/__tests__/rights_gate.test.ts
//
// The rights gate is what stops a locally generated asset whose base-model
// licence forbids redistribution from being published. Recording the licence
// truthfully (which `sync_emberwatch_credits.ts` does) is necessary but not
// sufficient — something has to act on it.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeRightsGateFailure,
  loadAcknowledgedRightsTags,
  RESTRICTED_LICENSE_TERMS,
  runRightsGate,
} from '../rights_gate.ts';

const entries = (tags: string[]) => tags.map((tag) => ({ tag }));

describe('runRightsGate — a declared licence that forbids distribution blocks', () => {
  test('the real Anima licence blocks the tag that carries it', () => {
    const result = runRightsGate({
      entries: entries(['emberwatch:portraits:village_elder:neutral']),
      creditsByTag: {
        'emberwatch:portraits:village_elder:neutral': {
          licenses: ['circlestone-labs-non-commercial-license'],
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockedTags).toEqual(['emberwatch:portraits:village_elder:neutral']);
    expect(result.matches[0]?.reason).toBe('non-commercial use only');
  });

  test('every declared restriction term is detected', () => {
    for (const { term } of RESTRICTED_LICENSE_TERMS) {
      const license = `some-vendor-${term}-license`;
      const result = runRightsGate({
        entries: entries(['t']),
        creditsByTag: { t: { licenses: [license] } },
      });
      expect(result.ok).toBe(false);
    }
  });

  test('detection is case-insensitive', () => {
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: { t: { licenses: ['CC-BY-NC-4.0'] } },
    });
    expect(result.ok).toBe(false);
  });

  test('permissive licences pass', () => {
    const result = runRightsGate({
      entries: entries(['a', 'b', 'c']),
      creditsByTag: {
        a: { licenses: ['MIT'] },
        b: { licenses: ['CC-BY-SA 3.0'] },
        c: { licenses: ['Apache-2.0'] },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.blockedTags).toEqual([]);
    expect(result.checkedCount).toBe(3);
  });

  test('one blocked tag blocks the whole publish', () => {
    // A release is all-or-nothing: publishing the permitted subset would ship
    // a pack missing the art it references.
    const result = runRightsGate({
      entries: entries(['ok', 'blocked']),
      creditsByTag: {
        ok: { licenses: ['MIT'] },
        blocked: { licenses: ['research-only'] },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.blockedTags).toEqual(['blocked']);
  });

  test('a tag with no declared licence is not silently treated as blocked', () => {
    // Absence of a licence is the ATTRIBUTION preflight's problem; this gate
    // only rules on licences that were actually declared.
    const result = runRightsGate({
      entries: entries(['undeclared']),
      creditsByTag: {},
    });
    expect(result.ok).toBe(true);
    expect(result.checkedCount).toBe(1);
  });
});

describe('rights acknowledgements — a policy decision, not a flag', () => {
  test('an acknowledged tag is allowed through', () => {
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: { t: { licenses: ['circlestone-labs-non-commercial-license'] } },
      acknowledgedTags: new Set(['t']),
    });
    expect(result.ok).toBe(true);
  });

  test('an acknowledgement only clears the tag it names', () => {
    const result = runRightsGate({
      entries: entries(['cleared', 'not-cleared']),
      creditsByTag: {
        cleared: { licenses: ['circlestone-labs-non-commercial-license'] },
        'not-cleared': { licenses: ['circlestone-labs-non-commercial-license'] },
      },
      acknowledgedTags: new Set(['cleared']),
    });
    expect(result.ok).toBe(false);
    expect(result.blockedTags).toEqual(['not-cleared']);
  });

  test('no acknowledgements file means nothing is acknowledged', () => {
    expect(loadAcknowledgedRightsTags(mkdtempSync(join(tmpdir(), 'rights-none-'))).size).toBe(0);
  });

  test('an acknowledgement without a recorded decision is ignored', () => {
    // "Someone added the tag to a list" is not an auditable decision.
    const dir = mkdtempSync(join(tmpdir(), 'rights-bare-'));
    writeFileSync(
      join(dir, 'rights_acknowledgements.json'),
      JSON.stringify({
        acknowledged: [{ tag: 'bare' }, { tag: 'decided', decision: 'legal reviewed' }],
      }),
    );
    const acknowledged = loadAcknowledgedRightsTags(dir);
    expect(acknowledged.has('bare')).toBe(false);
    expect(acknowledged.has('decided')).toBe(true);
  });

  test('a malformed acknowledgements file does not clear the gate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rights-bad-'));
    writeFileSync(join(dir, 'rights_acknowledgements.json'), '{not json');
    expect(loadAcknowledgedRightsTags(dir).size).toBe(0);
  });
});

describe('describeRightsGateFailure', () => {
  test('names the tags and licences and gives remediation', () => {
    const result = runRightsGate({
      entries: entries(['t']),
      creditsByTag: { t: { licenses: ['circlestone-labs-non-commercial-license'] } },
    });
    const message = describeRightsGateFailure(result);
    expect(message).toContain('t');
    expect(message).toContain('circlestone-labs-non-commercial-license');
    expect(message).toContain('non-commercial use only');
    expect(message).toContain('Remediation');
    // It must not imply the model being available is permission.
    expect(message).toContain('not a redistribution grant');
  });
});

// packages/shared/constants/src/lib/development_ports.test.ts
//
// Brute-force proof that the per-contract port offset scheme never assigns
// the same port to two different (contract, service) combinations. This is
// the actual guarantee behind the STEP=66/SLOTS=163 comment in
// development_ports.ts — that comment is a summary, this test is the proof,
// and it must keep passing if either constant is ever changed.
//
// See the rig-audit findings (F-03): the previous STEP=10/SLOTS=200 pairing
// failed this exact check — slot wraparound (id % 200) collided every 200
// contracts, and OFFSETTABLE_PORTS.storage/.auth differ by exactly 10×STEP,
// colliding every 10 slots (760 pairs across ids 1..400).

import { describe, expect, it } from 'bun:test';
import {
  CONTRACT_PORT_SLOTS,
  contractPortOffset,
  FIXED_PORTS,
  OFFSETTABLE_PORTS,
  withPortOffset,
} from './development_ports.ts';

describe('contractPortOffset — collision-free across every contract slot', () => {
  it('never repeats an offset for two different contract ids within one wraparound period', () => {
    const seenOffsets = new Map<number, string>();
    for (let id = 1; id <= CONTRACT_PORT_SLOTS; id++) {
      const offset = contractPortOffset(`C-${id}`);
      const prior = seenOffsets.get(offset);
      expect(prior, `C-${id} and ${prior} both got offset ${offset}`).toBeUndefined();
      seenOffsets.set(offset, `C-${id}`);
    }
  });

  it('never assigns the same absolute port to two different (contract, offsettable-port) pairs — including the unshifted baseline (manual `bun run dev`, offset 0)', () => {
    const assignments = new Map<number, string>();

    // Slot 0 = no contract (offset 0) — real, permanent, runs alongside any
    // number of concurrent contract pipelines.
    for (const [name, base] of Object.entries(OFFSETTABLE_PORTS)) {
      assignments.set(base, `baseline:${name}`);
    }

    for (let id = 1; id <= CONTRACT_PORT_SLOTS; id++) {
      const offset = contractPortOffset(`C-${id}`);
      for (const [name, base] of Object.entries(OFFSETTABLE_PORTS)) {
        const port = base + offset;
        const owner = `C-${id}:${name}`;
        const prior = assignments.get(port);
        expect(prior, `${owner} and ${prior} both resolve to port ${port}`).toBeUndefined();
        assignments.set(port, owner);
      }
    }
  });

  it('never shifts an offsettable port onto a FIXED_PORTS value', () => {
    const fixedValues = new Set(Object.values(FIXED_PORTS));
    for (let id = 1; id <= CONTRACT_PORT_SLOTS; id++) {
      const offset = contractPortOffset(`C-${id}`);
      for (const [name, base] of Object.entries(OFFSETTABLE_PORTS)) {
        const port = base + offset;
        expect(
          fixedValues.has(port),
          `C-${id}:${name} (${port}) collides with a FIXED_PORTS value`,
        ).toBe(false);
      }
    }
  });

  it('is a pure function of the contract number (id in the string is irrelevant)', () => {
    expect(contractPortOffset('C-42')).toBe(contractPortOffset('MIG-42'));
    expect(contractPortOffset('C-42')).toBe(contractPortOffset('42'));
  });

  it('returns 0 only for no contract, never for a real one', () => {
    expect(contractPortOffset(undefined)).toBe(0);
    for (let id = 1; id <= CONTRACT_PORT_SLOTS; id++) {
      expect(contractPortOffset(`C-${id}`)).not.toBe(0);
    }
  });
});

describe('withPortOffset — shifts only OFFSETTABLE_PORTS keys', () => {
  it('leaves FIXED_PORTS keys untouched even when merged into the same object', () => {
    const merged = { ...OFFSETTABLE_PORTS, ...FIXED_PORTS };
    const shifted = withPortOffset(merged, 66);
    for (const [name, base] of Object.entries(OFFSETTABLE_PORTS)) {
      expect(shifted[name]).toBe(base + 66);
    }
    for (const [name, base] of Object.entries(FIXED_PORTS)) {
      expect(shifted[name]).toBe(base);
    }
  });

  it('is a no-op at offset 0', () => {
    const merged = { ...OFFSETTABLE_PORTS, ...FIXED_PORTS };
    expect(withPortOffset(merged, 0)).toEqual(merged);
  });
});

// packages/shared/constants/src/lib/project.test.ts

import { describe, expect, it } from 'bun:test';
import { MODE_PROJECT_MAP, withProjectIdOffset } from './project.ts';

describe('withProjectIdOffset', () => {
  it('leaves the project id untouched for offset 0 (manual, non-contract dev)', () => {
    expect(withProjectIdOffset(MODE_PROJECT_MAP.emulator, 0)).toBe(MODE_PROJECT_MAP.emulator);
  });

  it('suffixes a demo project id by the offset', () => {
    expect(withProjectIdOffset(MODE_PROJECT_MAP.emulator, 330)).toBe(
      `${MODE_PROJECT_MAP.emulator}-330`,
    );
  });

  it('gives two different offsets two different, non-colliding project ids', () => {
    const a = withProjectIdOffset(MODE_PROJECT_MAP.emulator, 66);
    const b = withProjectIdOffset(MODE_PROJECT_MAP.emulator, 132);
    expect(a).not.toBe(b);
  });

  it('never mutates a real (non-demo) GCP project id, even with a nonzero offset', () => {
    expect(withProjectIdOffset(MODE_PROJECT_MAP.staging, 66)).toBe(MODE_PROJECT_MAP.staging);
    expect(withProjectIdOffset(MODE_PROJECT_MAP.production, 66)).toBe(MODE_PROJECT_MAP.production);
  });

  it('leaves a negative offset untouched (defensive — offsets are never negative in practice)', () => {
    expect(withProjectIdOffset(MODE_PROJECT_MAP.emulator, -1)).toBe(MODE_PROJECT_MAP.emulator);
  });
});

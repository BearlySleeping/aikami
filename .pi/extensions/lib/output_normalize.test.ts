import { describe, expect, test } from 'bun:test';
import {
  lastMeaningfulLine,
  normalizeOutput,
  outputFingerprint,
  resolveCarriageReturns,
  stripAnsi,
} from './output_normalize.ts';

const ESC = '\u001B';

describe('stripAnsi', () => {
  test('removes SGR colour codes', () => {
    expect(stripAnsi(`${ESC}[31merror${ESC}[0m`)).toBe('error');
  });

  test('removes cursor movement and erase-line codes', () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gbuilding`)).toBe('building');
  });

  test('removes OSC title sequences terminated by BEL', () => {
    expect(stripAnsi(`${ESC}]0;my title\u0007done`)).toBe('done');
  });

  test('removes OSC sequences terminated by ST', () => {
    expect(stripAnsi(`${ESC}]0;title${ESC}\\done`)).toBe('done');
  });

  test('leaves plain text untouched', () => {
    expect(stripAnsi('Compiling aikami v0.1.0')).toBe('Compiling aikami v0.1.0');
  });
});

describe('resolveCarriageReturns', () => {
  test('keeps only the final painted segment', () => {
    expect(resolveCarriageReturns('10%\r20%\r30%')).toBe('30%');
  });

  test('a shorter redraw leaves the tail of the longer one visible', () => {
    // Real terminals overwrite from column 0 and do not clear the remainder,
    // so the tail of the longer previous line survives. Tools that care emit
    // an erase-line (ESC[2K) first, which stripAnsi removes before this runs.
    expect(resolveCarriageReturns('building...\rdone')).toBe('doneding...');
  });

  test('is a no-op for lines without carriage returns', () => {
    expect(resolveCarriageReturns('a\nb\nc')).toBe('a\nb\nc');
  });

  test('handles each line independently', () => {
    expect(resolveCarriageReturns('1\r2\nx\ry')).toBe('2\ny');
  });
});

describe('normalizeOutput', () => {
  test('a redrawn progress bar collapses to one stable line', () => {
    // The exact failure mode that breaks naive polling: identical logical
    // state, different bytes on every sample.
    const sampleA = `${ESC}[2K\r  Building [=====>     ] 42% 1.2 MiB in 4.21s`;
    const sampleB = `${ESC}[2K\r  Building [=======>   ] 57% 1.9 MiB in 6.84s`;
    expect(normalizeOutput(sampleA)).toBe(normalizeOutput(sampleB));
  });

  test('genuinely different output stays different', () => {
    expect(normalizeOutput('Compiling foo')).not.toBe(normalizeOutput('Compiling bar'));
  });

  test('scrubs timestamps', () => {
    expect(normalizeOutput('2026-08-14T13:41:02 ready')).toBe('<ts> ready');
    expect(normalizeOutput('13:41:02.123 ready')).toBe('<ts> ready');
  });

  test('scrubs durations, bytes, percents and fractions', () => {
    expect(normalizeOutput('done in 4.21s')).toBe('done in <dur>');
    expect(normalizeOutput('wrote 1.2 MiB')).toBe('wrote <bytes>');
    expect(normalizeOutput('42%')).toBe('<pct>');
    expect(normalizeOutput('[12/34] linking')).toBe('<frac> linking');
  });

  test('scrubs ASCII and unicode progress bars', () => {
    expect(normalizeOutput('[=====>    ] go')).toBe('<bar> go');
    expect(normalizeOutput('[####......] go')).toBe('<bar> go');
    expect(normalizeOutput('[██░░] go')).toBe('<bar> go');
  });

  test('leaves short bracketed literals alone', () => {
    expect(normalizeOutput('[ok] done')).toBe('[ok] done');
  });

  test('scrubs hex ids such as commit shas', () => {
    expect(normalizeOutput('at commit 7bdb93ba')).toBe('at commit <hex>');
  });

  test('scrubVolatile:false preserves counters', () => {
    const out = normalizeOutput('queue depth 42', { scrubVolatile: false });
    expect(out).toBe('queue depth 42');
  });

  test('drops blank lines and collapses whitespace', () => {
    expect(normalizeOutput('a\n\n\n   b    c  \n')).toBe('a\nb c');
  });

  test('tailLines keeps only the last N lines', () => {
    expect(normalizeOutput('a\nb\nc\nd', { tailLines: 2 })).toBe('c\nd');
  });

  test('tailLines is a no-op when output is shorter', () => {
    expect(normalizeOutput('a\nb', { tailLines: 5 })).toBe('a\nb');
  });
});

describe('outputFingerprint', () => {
  test('is stable across cosmetic churn', () => {
    const a = `${ESC}[32m✔${ESC}[0m built in 1.2s`;
    const b = `${ESC}[32m✔${ESC}[0m built in 9.9s`;
    expect(outputFingerprint(a)).toBe(outputFingerprint(b));
  });

  test('changes when real content changes', () => {
    expect(outputFingerprint('step one')).not.toBe(outputFingerprint('step two'));
  });

  test('is a short hex digest', () => {
    expect(outputFingerprint('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('lastMeaningfulLine', () => {
  test('returns the final non-empty line', () => {
    expect(lastMeaningfulLine('a\nb\n\n\n')).toBe('b');
  });

  test('resolves redraws before picking the line', () => {
    expect(lastMeaningfulLine('start\n10%\r99%\n')).toBe('99%');
  });

  test('returns empty string for blank output', () => {
    expect(lastMeaningfulLine('\n\n  \n')).toBe('');
  });
});

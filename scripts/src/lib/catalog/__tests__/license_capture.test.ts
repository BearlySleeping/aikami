// scripts/src/lib/catalog/__tests__/license_capture.test.ts
//
// License capture tests (C-395 AC-4): CREDITS.csv parsing and the output-tag
// join in lpc_credits.ts. The preflight gate itself is covered by
// publish_preflight.test.ts; these assert the capture layer — verbatim
// strings, multi-license arrays, the join key, and the exact output tag.

import { describe, expect, test } from 'bun:test';
import {
  buildLpcCreditsSidecar,
  LPC_LIBRARY_CREDIT,
  lpcOutputTag,
  parseCreditsCsv,
  parseCsvLine,
  parseLpcSourcePath,
  resolveLpcCredit,
} from '../lpc_credits.ts';

// ---------------------------------------------------------------------------
// parseCsvLine
// ---------------------------------------------------------------------------

describe('parseCsvLine', () => {
  test('splits a plain unquoted line', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('keeps commas inside quoted fields', () => {
    expect(parseCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
  });

  test('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsvLine('"say ""hi""",b')).toEqual(['say "hi"', 'b']);
  });

  test('handles an empty field', () => {
    expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

// ---------------------------------------------------------------------------
// parseCreditsCsv
// ---------------------------------------------------------------------------

const CREDITS_CSV = `filename,notes,authors,licenses,urls
"body/bodies/male/spellcast.png","see details at https://example.org; 'Thick' Male" ,"bluecarrot16,JaidynReiman,Eliza Wyatt (ElizaWy)" ,"OGA-BY 3.0,CC-BY-SA 3.0,GPL 3.0" ,"https://opengameart.org/content/a,https://opengameart.org/content/b" 
"hat/magic/celestial_moon.png","multi-line, comma note" ,"bluecarrot16" ,"CC-BY-SA 3.0" ,"https://opengameart.org/content/c" 
`;

describe('parseCreditsCsv', () => {
  test('parses rows keyed by spritesheet-relative filename', () => {
    const rows = parseCreditsCsv(CREDITS_CSV);
    expect(rows.size).toBe(2);
    expect(rows.get('body/bodies/male/spellcast.png')?.licenses).toEqual([
      'OGA-BY 3.0',
      'CC-BY-SA 3.0',
      'GPL 3.0',
    ]);
  });

  test('keeps license strings verbatim — never SPDX-normalised (AC-4)', () => {
    const rows = parseCreditsCsv(CREDITS_CSV);
    const row = rows.get('body/bodies/male/spellcast.png');
    expect(row?.licenses).toContain('OGA-BY 3.0');
  });

  test('keeps multi-license as an array, not a single string (AC-4)', () => {
    const rows = parseCreditsCsv(CREDITS_CSV);
    const licenses = rows.get('body/bodies/male/spellcast.png')?.licenses ?? [];
    expect(Array.isArray(licenses)).toBe(true);
    expect(licenses.length).toBe(3);
  });

  test('splits author and URL lists on commas', () => {
    const rows = parseCreditsCsv(CREDITS_CSV);
    const row = rows.get('body/bodies/male/spellcast.png');
    expect(row?.authors).toEqual(['bluecarrot16', 'JaidynReiman', 'Eliza Wyatt (ElizaWy)']);
    expect(row?.urls).toEqual([
      'https://opengameart.org/content/a',
      'https://opengameart.org/content/b',
    ]);
  });

  test('captures the freeform note verbatim', () => {
    const rows = parseCreditsCsv(CREDITS_CSV);
    expect(rows.get('hat/magic/celestial_moon.png')?.notes).toBe('multi-line, comma note');
  });

  test('ignores the header row', () => {
    const rows = parseCreditsCsv(CREDITS_CSV);
    expect(rows.has('filename')).toBe(false);
  });

  test('returns an empty map for empty content', () => {
    expect(parseCreditsCsv('').size).toBe(0);
    expect(parseCreditsCsv('filename,notes,authors,licenses,urls\n').size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lpcOutputTag
// ---------------------------------------------------------------------------

describe('lpcOutputTag', () => {
  test('derives the manifest tag from the collected state', () => {
    expect(
      lpcOutputTag({ slot: 'hat', type: 'magic/celestial', bodyType: 'adult', anim: 'thrust' }),
    ).toBe('lpc:hat:magic:celestial_adult:thrust');
  });

  test('omits the body-type suffix for default bodies', () => {
    expect(lpcOutputTag({ slot: 'hat', type: 'round', bodyType: 'default', anim: 'thrust' })).toBe(
      'lpc:hat:round:thrust',
    );
  });

  test('matches a real manifest tag with an embedded variant suffix in the type', () => {
    expect(
      lpcOutputTag({
        slot: 'hat',
        type: 'magic/celestial_moon_adult',
        bodyType: 'default',
        anim: 'backslash',
      }),
    ).toBe('lpc:hat:magic:celestial_moon_adult:backslash');
  });

  test('matches the contract example tag shape', () => {
    expect(
      lpcOutputTag({ slot: 'hat', type: 'magic/celestial', bodyType: 'adult', anim: 'thrust' }),
    ).toBe('lpc:hat:magic:celestial_adult:thrust');
  });
});

// ---------------------------------------------------------------------------
// resolveLpcCredit — tiered join
// ---------------------------------------------------------------------------

describe('resolveLpcCredit', () => {
  const csv = parseCreditsCsv(CREDITS_CSV);
  const opts = {
    creditsCsv: csv,
    spritesheetsDir: '/gen/spritesheets',
  };

  /** Parse or throw — keeps tests free of non-null assertions. */
  const parsedOrThrow = (rel: string) => {
    const parsed = parseLpcSourcePath(rel);
    if (!parsed) {
      throw new Error(`failed to parse ${rel}`);
    }
    return parsed;
  };

  test('tier 1 — resolves the exact spritesheet-relative path', () => {
    const credit = resolveLpcCredit({
      ...opts,
      sourcePath: '/gen/spritesheets/body/bodies/male/spellcast.png',
      parsed: parsedOrThrow('body/bodies/male/spellcast.png'),
    });
    expect(credit?.licenses).toContain('OGA-BY 3.0');
    expect(credit?.authors).toContain('JaidynReiman');
  });

  test('tier 2 — same asset (slot/type/bodyType) falls back to the asset credit', () => {
    // Source is a nested animation variant of the same asset; CREDITS.csv
    // credits the flat variant file. Both parse to the same asset key.
    const credit = resolveLpcCredit({
      ...opts,
      sourcePath: '/gen/spritesheets/body/bodies/male/thrust.png',
      parsed: parsedOrThrow('body/bodies/male/thrust.png'),
    });
    expect(credit?.licenses).toEqual(['OGA-BY 3.0', 'CC-BY-SA 3.0', 'GPL 3.0']);
  });

  test('tier 3 — head template rows match concrete head variants', () => {
    const placeholder = '\u0024{head}';
    const templateCsv = parseCreditsCsv(
      [
        'filename,notes,authors,licenses,urls',
        `"head/faces/${placeholder}/anger/spellcast.png",,"bluecarrot16","CC-BY-SA 3.0","https://x"`,
        `"head/faces/${placeholder}/anger/thrust.png",,"bluecarrot16","CC-BY-SA 3.0","https://x"`,
      ].join('\n'),
    );
    const credit = resolveLpcCredit({
      creditsCsv: templateCsv,
      spritesheetsDir: '/gen/spritesheets',
      sourcePath: '/gen/spritesheets/head/faces/male/anger/spellcast.png',
      parsed: parsedOrThrow('head/faces/male/anger/spellcast.png'),
    });
    expect(credit?.authors).toEqual(['bluecarrot16']);
  });

  test('returns undefined when no tier resolves', () => {
    const credit = resolveLpcCredit({
      ...opts,
      sourcePath: '/gen/spritesheets/eyes/human/adult/anger/backslash.png',
      parsed: parsedOrThrow('eyes/human/adult/anger/backslash.png'),
    });
    expect(credit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LPC_LIBRARY_CREDIT
// ---------------------------------------------------------------------------

describe('LPC_LIBRARY_CREDIT', () => {
  test('carries the LPC library triple license, non-empty authors, and a note', () => {
    expect(LPC_LIBRARY_CREDIT.licenses).toContain('CC-BY-SA 3.0');
    expect(LPC_LIBRARY_CREDIT.licenses).toContain('GPL 3.0');
    expect(LPC_LIBRARY_CREDIT.authors.length).toBeGreaterThan(0);
    expect(LPC_LIBRARY_CREDIT.licenseNote).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildLpcCreditsSidecar
// ---------------------------------------------------------------------------

describe('buildLpcCreditsSidecar', () => {
  const creditsCsv = parseCreditsCsv(CREDITS_CSV);

  test('joins source paths to output tags via CREDITS.csv rows', () => {
    const sidecar = buildLpcCreditsSidecar({
      states: [
        {
          parsed: { slot: 'body', type: 'bodies', bodyType: 'male', anim: 'spellcast' },
          sourcePath: '/gen/spritesheets/body/bodies/male/spellcast.png',
        },
      ],
      creditsCsv,
      spritesheetsDir: '/gen/spritesheets',
      generatedAt: '2026-08-15T00:00:00.000Z',
    });

    expect(sidecar.credits['lpc:body:bodies_male:spellcast']).toEqual({
      licenses: ['OGA-BY 3.0', 'CC-BY-SA 3.0', 'GPL 3.0'],
      authors: ['bluecarrot16', 'JaidynReiman', 'Eliza Wyatt (ElizaWy)'],
      sourceUrls: ['https://opengameart.org/content/a', 'https://opengameart.org/content/b'],
      licenseNote: "see details at https://example.org; 'Thick' Male",
    });
    expect(sidecar.unresolvedSources).toEqual([]);
    expect(sidecar.assetCount).toBe(1);
  });

  test('omits licenseNote when the upstream note is blank', () => {
    const sidecar = buildLpcCreditsSidecar({
      states: [
        {
          parsed: { slot: 'hat', type: 'magic/celestial_moon', bodyType: 'default', anim: 'idle' },
          sourcePath: '/gen/spritesheets/hat/magic/celestial_moon.png',
        },
      ],
      creditsCsv: parseCreditsCsv(
        'filename,notes,authors,licenses,urls\n"hat/magic/celestial_moon.png",,"bluecarrot16","CC-BY-SA 3.0","https://x"',
      ),
      spritesheetsDir: '/gen/spritesheets',
    });

    const entry = sidecar.credits['lpc:hat:magic:celestial_moon:idle'];
    expect(entry?.licenseNote).toBeUndefined();
    expect(entry?.licenses).toEqual(['CC-BY-SA 3.0']);
  });

  test('reports sources with no CREDITS.csv row as unresolved', () => {
    const sidecar = buildLpcCreditsSidecar({
      states: [
        {
          parsed: { slot: 'weapon', type: 'staff', bodyType: 'default', anim: 'thrust' },
          sourcePath: '/gen/spritesheets/weapon/staff/thrust.png',
        },
      ],
      creditsCsv,
      spritesheetsDir: '/gen/spritesheets',
    });

    expect(sidecar.credits).toEqual({});
    expect(sidecar.unresolvedSources).toEqual(['weapon/staff/thrust.png']);
  });

  test('deduplicates states that map to the same output tag', () => {
    const sidecar = buildLpcCreditsSidecar({
      states: [
        {
          parsed: { slot: 'body', type: 'bodies/male', bodyType: 'default', anim: 'spellcast' },
          sourcePath: '/gen/spritesheets/body/bodies/male/spellcast.png',
        },
        {
          parsed: { slot: 'body', type: 'bodies/male', bodyType: 'default', anim: 'spellcast' },
          sourcePath: '/gen/spritesheets/body/bodies/male/spellcast.png',
        },
      ],
      creditsCsv,
      spritesheetsDir: '/gen/spritesheets',
    });

    expect(sidecar.assetCount).toBe(1);
    expect(Object.keys(sidecar.credits).length).toBe(1);
  });
});

// scripts/src/lib/catalog/lpc_credits.ts
//
// LPC credits sidecar generation (C-395 AC-4).
//
// The upstream generator is vendored at
// examples/Universal-LPC-Spritesheet-Character-Generator/ and ships
// CREDITS.csv (13,787 rows) with columns
// `filename,notes,authors,licenses,urls`, keyed by the spritesheet path
// relative to spritesheets/ (e.g. `body/bodies/male/spellcast.png`).
//
// collect_lpc_assets.ts picks one source PNG per output state
// (bestPerState) and this module joins each chosen source back to its
// CREDITS.csv row, emitting a sidecar keyed by the OUTPUT asset tag
// (e.g. `lpc:hat:magic:celestial_adult:thrust`) carrying the upstream
// license/author/source strings VERBATIM.
//
// The join is tiered because the generator's on-disk tree (144,699 PNGs)
// is far larger than CREDITS.csv (13,465 parseable rows): the collector
// picks nested/colour/animation variant files that CREDITS.csv does not
// credit by exact path. Verified 2026-08-15 against the real data:
//
//   Tier 1 — exact spritesheet-relative path            → ~45% of states
//   Tier 2 — same asset (slot/type/bodyType, any anim)  → ~89% cumulative,
//            zero credit ambiguity across all 12,699 states
//   Tier 3 — `${head}` template rows (head/faces)        → +~4%
//   Tier 4 — committed lpc_credits_supplement.json      → the remainder
//            (LPC library assets with no per-file CREDITS row, e.g.
//            `eyes/human/*` which has zero rows upstream)
//
// Every tier is deterministic and the publish preflight (preflight.ts)
// still hard-fails on any catalog tag resolved by NO tier.
//
// License strings are deliberately NOT SPDX-normalised: LPC publishes
// "OGA-BY 3.0" which has no SPDX identifier, and multi-licensing
// ("OGA-BY 3.0,CC-BY-SA 3.0,GPL 3.0" — recipient may choose one) is the
// norm. Empty arrays are representable (genuinely unknown) but the publish
// preflight refuses to publish such entries.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

// ---------------------------------------------------------------------------
// CREDITS.csv row shape
// ---------------------------------------------------------------------------

export type LpcCreditsRow = {
  /** Spritesheet path relative to spritesheets/, e.g. "body/bodies/male/spellcast.png". */
  filename: string;
  /** Freeform upstream note. */
  notes: string;
  /** Upstream authors, verbatim. */
  authors: readonly string[];
  /** Upstream license strings, verbatim — NOT SPDX. */
  licenses: readonly string[];
  /** Upstream source URLs. */
  urls: readonly string[];
};

// ---------------------------------------------------------------------------
// Minimal RFC4180-ish CSV parser
// ---------------------------------------------------------------------------

/**
 * Split one CSV line into fields, honouring double-quoted fields (which may
 * contain commas, quotes escaped as `""`, and newlines). CREDITS.csv rows
 * are single-line quoted fields.
 */
export const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      fields.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current);
  return fields;
};

/**
 * Parse CREDITS.csv content into a map keyed by the spritesheet-relative
 * filename. Returns an empty map for missing/unparseable content rather than
 * throwing — the collector degrades to "no sidecar" when the vendored
 * generator is absent (examples/ is gitignored).
 */
export const parseCreditsCsv = (content: string): Map<string, LpcCreditsRow> => {
  const rows = new Map<string, LpcCreditsRow>();
  const lines = content.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    const fields = parseCsvLine(line);
    if (fields.length < 5) {
      continue;
    }
    const [filename, notes, authorsRaw, licensesRaw, urlsRaw] = fields;
    if (!filename) {
      continue;
    }
    rows.set(filename, {
      filename,
      // Trim field edges: CREDITS.csv pads quoted cells with spaces before
      // commas (`"value" ,"next"`), which would otherwise corrupt the note.
      notes: notes.trim(),
      authors: splitList(authorsRaw),
      licenses: splitList(licensesRaw),
      urls: splitList(urlsRaw),
    });
  }
  return rows;
};

/** Split a CREDITS.csv list cell ("A,B") into trimmed entries. */
const splitList = (raw: string): string[] =>
  raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

// ---------------------------------------------------------------------------
// Source path parsing — the collector's key derivation, single source of truth
// ---------------------------------------------------------------------------

/** Slot directory → catalog slot (the collector's SLOT_MAP). */
export const LPC_SLOT_MAP: Readonly<Record<string, string>> = {
  body: 'body',
  head: 'head',
  hair: 'hair',
  torso: 'torso',
  legs: 'legs',
  feet: 'feet',
  hat: 'hat',
  shoulders: 'shoulders',
  shield: 'shield',
  weapon: 'weapon',
  cape: 'cape',
  eyes: 'eyes',
  facial: 'facial',
  neck: 'neck',
  beards: 'beard',
  dress: 'dress',
};

/** Path segments treated as body-type markers (the collector's BODY_CANDIDATES). */
export const LPC_BODY_CANDIDATES: ReadonlySet<string> = new Set([
  'male',
  'female',
  'adult',
  'child',
  'teen',
  'thin',
  'muscular',
  'pregnant',
  'bg',
  'fg',
  'foreground',
  'background',
  'universal',
  'mask',
]);

/** Path segments treated as animation-state markers (the collector's ANIM_CANDIDATES). */
export const LPC_ANIM_CANDIDATES: ReadonlySet<string> = new Set([
  'walk',
  'idle',
  'combat_idle',
  'run',
  'jump',
  'sit',
  'climb',
  'emote',
  'thrust',
  'slash',
  'halfslash',
  'backslash',
  'shoot',
  'hurt',
  'spellcast',
  'die',
]);

/** Shape of a parsed LPC source path (mirrors collect_lpc_assets.ts parsePath). */
export type LpcParsedState = {
  slot: string;
  type: string;
  bodyType: string;
  anim: string;
  color: string;
};

/**
 * Parse a spritesheet-relative path into its catalog identity. This is the
 * collector's `parsePath`, moved here so the CREDITS join and the collector
 * share one key derivation (any drift between them is exactly what AC-4's
 * preflight is designed to catch).
 */
export const parseLpcSourcePath = (relPath: string): LpcParsedState | null => {
  const parts = relPath.split('/');
  if (parts.length < 2) {
    return null;
  }

  const slot = parts[0];
  if (!LPC_SLOT_MAP[slot]) {
    return null;
  }

  let bodyIdx = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (LPC_BODY_CANDIDATES.has(parts[i])) {
      bodyIdx = i;
      break;
    }
  }

  let animIdx = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (LPC_ANIM_CANDIDATES.has(parts[i])) {
      animIdx = i;
      break;
    }
  }

  const fileBase = parts[parts.length - 1].replace(/\.png$/, '');
  const isAnimFile = LPC_ANIM_CANDIDATES.has(fileBase);

  if (isAnimFile) {
    // File IS the animation state: e.g. shield/round/thrust.png
    const typeParts = parts.slice(1, -1);
    let bodyType = 'default';
    if (bodyIdx > 0) {
      bodyType = parts[bodyIdx];
      // Remove body type from type parts (bodyIdx is index in parts, index in typeParts = bodyIdx - 1)
      typeParts.splice(bodyIdx - 1, 1);
    } else {
      const maybeBody = typeParts[typeParts.length - 1];
      if (LPC_BODY_CANDIDATES.has(maybeBody)) {
        bodyType = maybeBody;
        typeParts.pop();
      }
    }
    return {
      slot: LPC_SLOT_MAP[slot],
      type: typeParts.join('/'),
      bodyType,
      anim: fileBase,
      color: 'default',
    };
  }

  if (bodyIdx > 0) {
    const typeParts = parts.slice(1, bodyIdx);
    const bodyType = parts[bodyIdx];
    const rest = parts.slice(bodyIdx + 1);
    const anim = rest.length > 1 && LPC_ANIM_CANDIDATES.has(rest[0]) ? rest[0] : 'idle';
    const color = parts[parts.length - 1].replace(/\.png$/, '');
    return { slot: LPC_SLOT_MAP[slot], type: typeParts.join('/'), bodyType, anim, color };
  }

  if (animIdx > 0) {
    const typeParts = parts.slice(1, animIdx);
    const anim = parts[animIdx];
    const color = parts[parts.length - 1].replace(/\.png$/, '');
    return {
      slot: LPC_SLOT_MAP[slot],
      type: typeParts.join('/'),
      bodyType: 'default',
      anim,
      color,
    };
  }

  const typeParts = parts.slice(1, -1);
  const color = fileBase;
  return {
    slot: LPC_SLOT_MAP[slot],
    type: typeParts.join('/'),
    bodyType: 'default',
    anim: 'idle',
    color,
  };
};

// ---------------------------------------------------------------------------
// Output tag derivation
// ---------------------------------------------------------------------------

/**
 * Derive the OUTPUT asset tag for a collected LPC state, matching exactly
 * what scan_assets.ts produces from the converted file path:
 * `lpc/<slot>/<type><_bodyType>.<anim>.webp` → `lpc:<slot>:<type>:_bodyType:<anim>`.
 *
 * @example { slot: 'hat', type: 'magic/celestial', bodyType: 'adult', anim: 'thrust' }
 *   → "lpc:hat:magic:celestial_adult:thrust"
 */
export const lpcOutputTag = (
  state: Pick<LpcParsedState, 'slot' | 'type' | 'bodyType' | 'anim'>,
): string => {
  const { slot, type, bodyType, anim } = state;
  const btSuffix = bodyType !== 'default' ? `_${bodyType}` : '';
  return `lpc:${slot}:${type.split('/').join(':')}${btSuffix}:${anim}`;
};

// ---------------------------------------------------------------------------
// Tiered credit resolution
// ---------------------------------------------------------------------------

/** One entry of the lpc_credits.json sidecar — CatalogAssetEntry credit fields. */
export type LpcCreditEntry = {
  licenses: readonly string[];
  authors: readonly string[];
  sourceUrls: readonly string[];
  licenseNote?: string;
};

/** The lpc_credits.json sidecar document. */
export type LpcCreditsSidecar = {
  /** ISO 8601 — when the sidecar was generated. */
  generatedAt: string;
  /** Number of resolved output tags. */
  assetCount: number;
  /** Output asset tag → upstream credit (verbatim). */
  credits: Record<string, LpcCreditEntry>;
  /**
   * Source spritesheet paths (relative to spritesheets/) that resolved via
   * NO tier. The publish preflight will surface any tag derived from these
   * as unresolved unless the committed lpc_credits_supplement.json declares
   * it explicitly.
   */
  unresolvedSources: readonly string[];
  /**
   * Output asset tags whose source resolved via NO tier — the keys the
   * committed lpc_credits_supplement.json must declare (C-395 AC-4).
   */
  unresolvedTags: readonly string[];
};

/** Asset identity — slot + type + bodyType (animation/colour variants share it). */
const assetKeyOf = (parsed: Pick<LpcParsedState, 'slot' | 'type' | 'bodyType'>): string =>
  `${parsed.slot}/${parsed.type}/${parsed.bodyType}`;

/** Convert a credit row to the sidecar entry shape (verbatim). */
const rowToEntry = (row: LpcCreditsRow): LpcCreditEntry => {
  const entry: LpcCreditEntry = {
    licenses: row.licenses,
    authors: row.authors,
    sourceUrls: row.urls,
  };
  if (row.notes && row.notes.trim().length > 0) {
    entry.licenseNote = row.notes;
  }
  return entry;
};

/** Credit identity used to reject ambiguous fallbacks. */
const creditFingerprint = (entry: LpcCreditEntry): string =>
  JSON.stringify({
    licenses: entry.licenses,
    authors: entry.authors,
    sourceUrls: entry.sourceUrls,
  });

/**
 * Resolve the credit for a collected LPC state through the tier chain:
 *
 * 1. Exact CREDITS.csv path (spritesheet-relative).
 * 2. Same-asset fallback — any CREDITS row parsing to the same
 *    (slot/type/bodyType). Rejected if the asset maps to two distinct
 *    credits (ambiguous → treat as unresolved).
 * 3. `${head}` template rows — CREDITS.csv carries `head/faces/${head}/…`
 *    keys; match the concrete path against the template with `${head}`
 *    as a wildcard segment. Rejected if ambiguous.
 *
 * Returns undefined when no tier resolves — the caller records the source
 * as unresolved and the publish preflight gates on it.
 */
export const resolveLpcCredit = (options: {
  sourcePath: string;
  parsed: Pick<LpcParsedState, 'slot' | 'type' | 'bodyType'>;
  creditsCsv: Map<string, LpcCreditsRow>;
  spritesheetsDir: string;
}): LpcCreditEntry | undefined => {
  const { sourcePath, parsed, creditsCsv, spritesheetsDir } = options;

  // Tier 1: exact path.
  const exact = creditsCsv.get(relative(spritesheetsDir, sourcePath));
  if (exact) {
    return rowToEntry(exact);
  }

  // Tier 2: same asset (slot/type/bodyType), any anim/colour variant.
  const wantedAsset = assetKeyOf(parsed);
  const sameAsset = new Map<string, LpcCreditEntry>();
  for (const row of creditsCsv.values()) {
    const rowParsed = parseLpcSourcePath(row.filename);
    if (rowParsed && assetKeyOf(rowParsed) === wantedAsset) {
      sameAsset.set(creditFingerprint(rowToEntry(row)), rowToEntry(row));
    }
  }
  if (sameAsset.size === 1) {
    return sameAsset.values().next().value;
  }

  // Tier 3: `${head}` template rows (the only placeholder CREDITS.csv uses).
  const parts = relative(spritesheetsDir, sourcePath).split('/');
  const templateMatches = new Map<string, LpcCreditEntry>();
  const headPlaceholder = '\u0024{head}';
  for (const row of creditsCsv.values()) {
    if (!row.filename.includes('\u0024{')) {
      continue;
    }
    const rowParts = row.filename.split('/');
    if (rowParts.length !== parts.length) {
      continue;
    }
    let matches = true;
    for (let i = 0; i < rowParts.length; i++) {
      const rowSeg = rowParts[i];
      if (rowSeg === parts[i]) {
        continue;
      }
      if (rowSeg === headPlaceholder) {
        continue;
      }
      matches = false;
      break;
    }
    if (matches) {
      templateMatches.set(creditFingerprint(rowToEntry(row)), rowToEntry(row));
    }
  }
  if (templateMatches.size === 1) {
    return templateMatches.values().next().value;
  }

  return undefined;
};

/**
 * Build the credits sidecar for a set of collected states.
 *
 * @param states - Iterable of { parsed, sourcePath } pairs — the
 *   bestPerState map values from collect_lpc_assets.ts.
 * @param creditsCsv - Parsed CREDITS.csv (keyed by spritesheet-relative path).
 * @param spritesheetsDir - Absolute spritesheets/ dir (join key base).
 */
export const buildLpcCreditsSidecar = (options: {
  states: readonly {
    parsed: Pick<LpcParsedState, 'slot' | 'type' | 'bodyType' | 'anim'>;
    sourcePath: string;
  }[];
  creditsCsv: Map<string, LpcCreditsRow>;
  spritesheetsDir: string;
  generatedAt?: string;
}): LpcCreditsSidecar => {
  const { states, creditsCsv, spritesheetsDir, generatedAt } = options;
  const credits: Record<string, LpcCreditEntry> = {};
  const unresolvedSources: string[] = [];
  const unresolvedTags: string[] = [];
  const seenTags = new Set<string>();

  for (const { parsed, sourcePath } of states) {
    const tag = lpcOutputTag(parsed);
    if (seenTags.has(tag)) {
      continue;
    }
    seenTags.add(tag);

    const entry = resolveLpcCredit({ sourcePath, parsed, creditsCsv, spritesheetsDir });
    if (!entry) {
      unresolvedSources.push(relative(spritesheetsDir, sourcePath));
      unresolvedTags.push(tag);
      continue;
    }
    credits[tag] = entry;
  }

  unresolvedSources.sort();
  unresolvedTags.sort();

  return {
    generatedAt: generatedAt ?? new Date().toISOString(),
    assetCount: seenTags.size,
    credits,
    unresolvedSources,
    unresolvedTags,
  };
};

// ---------------------------------------------------------------------------
// LPC library-level declaration for assets CREDITS.csv does not cover
// ---------------------------------------------------------------------------

/**
 * Library-level attribution for LPC assets with no per-file CREDITS.csv row
 * (e.g. `eyes/human/*` — upstream CREDITS.csv has zero rows for it). These
 * are still LPC-library assets, so the declaration carries the LPC library's
 * standard license family and contributor attribution, with a note explaining
 * the basis. Written to lpc_credits_supplement.json by the collector and
 * consumed by the publish preflight (AC-4) — never silently defaulted.
 */
export const LPC_LIBRARY_CREDIT: LpcCreditEntry = {
  licenses: ['OGA-BY 3.0', 'CC-BY-SA 3.0', 'GPL 3.0'],
  authors: ['Liberated Pixel Cup (LPC) asset contributors'],
  sourceUrls: [
    'https://opengameart.org/content/lpc-base-assets-sprites-map-tiles',
    'https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles',
  ],
  licenseNote:
    'LPC library asset with no per-file CREDITS.csv row; attributed at library level (C-395 generated supplement).',
};

// ---------------------------------------------------------------------------
// File convenience
// ---------------------------------------------------------------------------

/**
 * Read and parse a CREDITS.csv file. Returns an empty map when the file is
 * absent (vendored generator not present — examples/ is gitignored).
 */
export const readCreditsCsv = (filePath: string): Map<string, LpcCreditsRow> => {
  try {
    return parseCreditsCsv(readFileSync(filePath, 'utf8'));
  } catch {
    return new Map();
  }
};

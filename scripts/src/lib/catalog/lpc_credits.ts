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
 *
 * Quoted fields may contain embedded newlines, so records are accumulated
 * line-by-line until the quote count balances before parsing. Malformed or
 * incomplete records (fewer than five fields, or a missing filename) are
 * skipped and reported via a warning — they never silently vanish.
 */
export const parseCreditsCsv = (content: string): Map<string, LpcCreditsRow> => {
  const rows = new Map<string, LpcCreditsRow>();
  const rawLines = content.split('\n');
  let skippedRows = 0;
  let i = 1; // skip the header row
  while (i < rawLines.length) {
    let pending = rawLines[i].trim();
    if (!pending) {
      i++;
      continue;
    }
    // Accumulate continuation lines while a quoted field is still open
    // (odd number of unescaped quote characters ⇒ the record continues).
    while (countQuotes(pending) % 2 !== 0 && i + 1 < rawLines.length) {
      i++;
      pending = `${pending}\n${rawLines[i]}`;
    }
    const fields = parseCsvLine(pending);
    if (fields.length < 5 || !fields[0]) {
      skippedRows++;
      i++;
      continue;
    }
    const [filename, notes, authorsRaw, licensesRaw, urlsRaw] = fields;
    rows.set(filename, {
      filename,
      // Trim field edges: CREDITS.csv pads quoted cells with spaces before
      // commas (`"value" ,"next"`), which would otherwise corrupt the note.
      notes: notes.trim(),
      authors: splitList(authorsRaw),
      licenses: splitList(licensesRaw),
      urls: splitList(urlsRaw),
    });
    i++;
  }
  if (skippedRows > 0) {
    console.warn(`parseCreditsCsv: skipped ${skippedRows} malformed/incomplete row(s)`);
  }
  return rows;
};

/** Count raw `"` characters — doubled quotes contribute an even count. */
const countQuotes = (value: string): number => value.split('"').length - 1;

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

/**
 * Prebuilt credit lookup index — built once from CREDITS.csv and consumed by
 * resolveLpcCredit so per-state resolution is O(1) for tiers 1-2 instead of
 * rescanning every row (13k rows × 12k states).
 */
export type LpcCreditsIndex = {
  /** Tier 1 — exact spritesheet-relative path → precomputed entry. */
  byPath: Map<string, LpcCreditEntry>;
  /**
   * Tier 2 — asset key (slot/type/bodyType) → the single distinct credit.
   * Absent when the asset key has no rows OR maps to 2+ distinct credits
   * (ambiguous → treated as unresolved, matching the old scan semantics).
   */
  byAssetKey: Map<string, LpcCreditEntry>;
  /** Tier 3 — rows whose filename contains a `${head}`-style placeholder. */
  templateRows: readonly { filename: string; entry: LpcCreditEntry }[];
};

/**
 * Build the credit lookup index from parsed CREDITS.csv rows.
 *
 * Parses each row once (path → asset key) and precomputes rowToEntry so
 * neither is repeated per resolved state.
 */
export const buildLpcCreditsIndex = (creditsCsv: Map<string, LpcCreditsRow>): LpcCreditsIndex => {
  const byPath = new Map<string, LpcCreditEntry>();
  const byAssetKeyRows = new Map<string, Map<string, LpcCreditEntry>>();
  const templateRows: { filename: string; entry: LpcCreditEntry }[] = [];

  for (const row of creditsCsv.values()) {
    const entry = rowToEntry(row);
    byPath.set(row.filename, entry);
    if (row.filename.includes('\u0024{')) {
      templateRows.push({ filename: row.filename, entry });
    }
    const rowParsed = parseLpcSourcePath(row.filename);
    if (!rowParsed) {
      continue;
    }
    const assetKey = assetKeyOf(rowParsed);
    const distinct = byAssetKeyRows.get(assetKey) ?? new Map<string, LpcCreditEntry>();
    distinct.set(creditFingerprint(entry), entry);
    byAssetKeyRows.set(assetKey, distinct);
  }

  const byAssetKey = new Map<string, LpcCreditEntry>();
  for (const [assetKey, distinct] of byAssetKeyRows) {
    if (distinct.size === 1) {
      byAssetKey.set(assetKey, distinct.values().next().value as LpcCreditEntry);
    }
  }

  return { byPath, byAssetKey, templateRows };
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
  /**
   * Paired unresolved records (tag ↔ spritesheet-relative source), sorted by
   * tag. Preserved so allowlist decisions (supplement generation) never have
   * to pair the independently-sorted flat arrays by index.
   */
  unresolved: readonly { tag: string; source: string }[];
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
  index: LpcCreditsIndex;
  spritesheetsDir: string;
}): LpcCreditEntry | undefined => {
  const { sourcePath, parsed, index, spritesheetsDir } = options;

  // Tier 1: exact path.
  const exact = index.byPath.get(relative(spritesheetsDir, sourcePath));
  if (exact) {
    return exact;
  }

  // Tier 2: same asset (slot/type/bodyType), any anim/colour variant. The
  // index stores the entry only when the asset key resolves to exactly one
  // distinct credit; ambiguous keys are absent and fall through to tier 3.
  const sameAsset = index.byAssetKey.get(assetKeyOf(parsed));
  if (sameAsset) {
    return sameAsset;
  }

  // Tier 3: `${head}` template rows (the only placeholder CREDITS.csv uses).
  const parts = relative(spritesheetsDir, sourcePath).split('/');
  const templateMatches = new Map<string, LpcCreditEntry>();
  const headPlaceholder = '\u0024{head}';
  for (const { filename, entry } of index.templateRows) {
    const rowParts = filename.split('/');
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
      templateMatches.set(creditFingerprint(entry), entry);
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
  const unresolved: { tag: string; source: string }[] = [];
  const seenTags = new Set<string>();
  const index = buildLpcCreditsIndex(creditsCsv);

  for (const { parsed, sourcePath } of states) {
    const tag = lpcOutputTag(parsed);
    if (seenTags.has(tag)) {
      continue;
    }
    seenTags.add(tag);

    const entry = resolveLpcCredit({ sourcePath, parsed, index, spritesheetsDir });
    if (!entry) {
      unresolved.push({ tag, source: relative(spritesheetsDir, sourcePath) });
      continue;
    }
    credits[tag] = entry;
  }

  unresolved.sort((a, b) => a.tag.localeCompare(b.tag) || a.source.localeCompare(b.source));

  return {
    generatedAt: generatedAt ?? new Date().toISOString(),
    assetCount: seenTags.size,
    credits,
    unresolvedSources: unresolved.map((record) => record.source),
    unresolvedTags: unresolved.map((record) => record.tag),
    unresolved,
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

/**
 * Committed allowlist of spritesheet-relative source prefixes that may be
 * declared at LPC library level in lpc_credits_supplement.json. Only
 * unresolved assets whose source starts with one of these prefixes receive
 * LPC_LIBRARY_CREDIT; every other unresolved tag stays undeclared so the
 * publish preflight (AC-4) continues to fail for unapproved assets. Verified
 * 2026-08-15 against the real data: these 31 prefixes cover exactly the 993
 * unresolved sources.
 */
export const LPC_SUPPLEMENT_APPROVED_SOURCE_PREFIXES: readonly string[] = [
  'dress/kimono',
  'eyes/human',
  'facial/earrings',
  'facial/masks',
  'hair/braid',
  'hair/curls_large',
  'hair/extensions',
  'hair/flat_top_fade',
  'hair/xlong',
  'hat/cloth',
  'hat/holiday',
  'hat/pirate',
  'hat/visor',
  'head/faces',
  'head/heads',
  'legs/pants',
  'neck/cravat',
  'neck/gem',
  'neck/jabot',
  'shield/crusader',
  'shield/crusader2',
  'shield/plus',
  'shield/scutum',
  'shield/scutum_trim',
  'shield/two_engrailed',
  'shield/two_engrailed_trim',
  'torso/clothes',
  'weapon/magic',
  'weapon/polearm',
  'weapon/ranged',
  'weapon/sword',
];

// ---------------------------------------------------------------------------
// File convenience
// ---------------------------------------------------------------------------

/**
 * Read and parse a CREDITS.csv file. Returns an empty map only when the file
 * is absent (vendored generator not present — examples/ is gitignored);
 * permission, decoding and parsing failures are re-thrown so the collector
 * does not misreport them as a missing CREDITS.csv.
 */
export const readCreditsCsv = (filePath: string): Map<string, LpcCreditsRow> => {
  try {
    return parseCreditsCsv(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }
};

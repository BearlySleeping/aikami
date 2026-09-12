// packages/shared/utils/src/lib/common/atlas_frames.ts
//
// Atlas frame-namespace helpers.
//
// A content pack's grid atlas and every irregular prop-atlas page share ONE
// flat frame namespace at runtime: a prop definition names a frame
// (`ward_large.png`) and the resolver indexes frames by that name across all
// sources. A name declared by two sources therefore has no defined winner, so
// it is rejected rather than resolved by precedence.
//
// Both the build-time packer gate and the runtime resolver use these helpers,
// so "what counts as a duplicate" cannot drift between the two.

/** One atlas source: a label for diagnostics plus the frame names it declares. */
export type AtlasFrameSource = {
  /** Human-readable source label used in diagnostics (e.g. `atlas`, `props#0`). */
  label: string;
  /** Frame names declared by this source. */
  frames: readonly string[];
};

/** A frame name declared by more than one atlas source. */
export type DuplicateAtlasFrame = {
  /** The ambiguous frame name. */
  name: string;
  /** Every source label that declares it, in input order. */
  sources: string[];
};

/**
 * Collects frame names declared by more than one atlas source.
 *
 * @param sources - One entry per atlas source.
 * @returns One entry per duplicated name, sorted by name. Empty when the
 *   namespace is unambiguous.
 */
export const findDuplicateAtlasFrames = (
  sources: readonly AtlasFrameSource[],
): DuplicateAtlasFrame[] => {
  const ownersByName = new Map<string, string[]>();
  for (const source of sources) {
    for (const frame of source.frames) {
      const owners = ownersByName.get(frame);
      if (owners) {
        owners.push(source.label);
      } else {
        ownersByName.set(frame, [source.label]);
      }
    }
  }

  const duplicates: DuplicateAtlasFrame[] = [];
  for (const [name, sources_] of ownersByName) {
    if (sources_.length > 1) {
      duplicates.push({ name, sources: sources_ });
    }
  }
  return duplicates.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Builds a frame-name → source-index lookup, rejecting ambiguous names.
 *
 * A name is indexed only when exactly one source declares it; a name declared
 * twice is left out of the index entirely so a lookup can never silently
 * return the wrong texture.
 *
 * @param sources - Frame names per source, in lookup-precedence order, each
 *   with a label so ambiguous entries can name every contributing source.
 * @returns The index plus the names that were excluded as ambiguous, each
 *   naming the sources that declared it.
 */
export const buildAtlasFrameIndex = (
  sources: readonly AtlasFrameSource[],
): { index: Map<string, number>; ambiguous: DuplicateAtlasFrame[] } => {
  const index = new Map<string, number>();
  const ownersByName = new Map<string, string[]>();

  sources.forEach((source, sourceIndex) => {
    for (const frame of source.frames) {
      const owners = ownersByName.get(frame);
      if (owners) {
        owners.push(source.label);
        continue;
      }
      ownersByName.set(frame, [source.label]);
      index.set(frame, sourceIndex);
    }
  });

  // Drop every ambiguous name — never leave a precedence winner behind.
  const ambiguous: DuplicateAtlasFrame[] = [];
  for (const [name, owners] of ownersByName) {
    if (owners.length > 1) {
      index.delete(name);
      ambiguous.push({ name, sources: owners });
    }
  }
  ambiguous.sort((a, b) => a.name.localeCompare(b.name));

  return { index, ambiguous };
};

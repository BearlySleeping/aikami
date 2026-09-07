// scripts/src/lib/release/notes.ts
/**
 * Release-note generation and promotion.
 *
 * Staging cuts generate notes from the commits since the last release.
 * Promoting to production does NOT regenerate them — it carries the staging
 * body forward verbatim, so whatever was hand-edited on the staging release
 * (the part a human actually wrote) is what ships. Anything that landed
 * between the staging cut and the promote is appended under its own heading
 * rather than silently folded in.
 */

export type Commit = { sha: string; subject: string };

/**
 * Conventional-commit type → section heading, in render order. Types not
 * listed here are dropped: they describe work on the repo, not changes a
 * player of the shipped app can observe.
 *
 * `docs` and `refactor` are deliberately absent. The contract pipeline emits
 * a `docs(contracts): C-NNN …` commit for every approve/implement/link step,
 * which on a real range outnumbers the actual changes several times over —
 * a first pass over v0.1.1..staging rendered 2 features, 11 fixes, and 40
 * lines of contract bookkeeping. Nobody reading a release page wants that.
 */
const SECTIONS: ReadonlyArray<{ types: readonly string[]; heading: string }> = [
  { types: ['feat'], heading: '### ✨ Features' },
  { types: ['fix'], heading: '### 🐛 Fixes' },
  { types: ['perf'], heading: '### ⚡ Performance' },
];

/** Heading used for commits with no recognised conventional-commit prefix. */
const OTHER_HEADING = '### Other';

/** Marks the appended tail on a promoted release (see `promoteNotes`). */
export const SINCE_STAGING_HEADING = '### Landed after the staging cut';

type ParsedCommit = { type: string | null; scope: string | null; description: string };

/**
 * Split `feat(engine)!: add fog` into its parts. Returns `type: null` for a
 * subject that isn't a conventional commit, so it still lands under "Other"
 * instead of being dropped.
 */
export const parseCommitSubject = (subject: string): ParsedCommit => {
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (!match?.[1] || !match[3]) {
    return { type: null, scope: null, description: subject.trim() };
  }
  return { type: match[1].toLowerCase(), scope: match[2] ?? null, description: match[3].trim() };
};

/** True for the merge commits and release-bump commits that add no signal. */
export const isNoiseCommit = (subject: string): boolean =>
  /^Merge (branch|pull request|remote-tracking)/.test(subject) ||
  /^chore\(release\):/.test(subject);

/**
 * Render grouped, de-duplicated notes for a set of commits.
 *
 * Duplicate subjects collapse to one bullet: a squash-merged PR whose branch
 * was also merged forward shows up twice in `git log`, and listing it twice
 * reads like it shipped twice.
 */
export const renderNotes = (commits: readonly Commit[]): string => {
  const buckets = new Map<string, string[]>();
  const seen = new Set<string>();

  for (const commit of commits) {
    if (isNoiseCommit(commit.subject)) {
      continue;
    }
    const { type, scope, description } = parseCommitSubject(commit.subject);

    // A recognised-but-unlisted type (chore, ci, test, build…) is dropped
    // outright. Only a subject with NO conventional prefix falls through to
    // "Other" — it might be user-facing work someone forgot to label, and
    // silently dropping that is worse than one stray bullet.
    //
    // Filtered BEFORE the dedupe bookkeeping: a dropped `chore: bump deps`
    // must not claim that description and suppress a later `feat: bump deps`.
    const section = type === null ? null : SECTIONS.find((s) => s.types.includes(type));
    if (type !== null && !section) {
      continue;
    }

    const key = description.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const heading = section?.heading ?? OTHER_HEADING;
    const bullet = scope ? `- **${scope}**: ${description}` : `- ${description}`;
    const existing = buckets.get(heading);
    if (existing) {
      existing.push(bullet);
    } else {
      buckets.set(heading, [bullet]);
    }
  }

  const ordered = [...SECTIONS.map((s) => s.heading), OTHER_HEADING];
  const blocks = ordered
    .filter((heading) => buckets.has(heading))
    .map((heading) => `${heading}\n\n${(buckets.get(heading) ?? []).join('\n')}`);

  return blocks.length > 0 ? blocks.join('\n\n') : '_No user-facing changes._';
};

/**
 * Body for a promoted production release: the staging body verbatim, plus a
 * tail section for anything that landed after the staging cut.
 *
 * Re-promoting is idempotent — an existing tail is replaced rather than
 * stacked, so a second promote of the same rc doesn't grow a duplicate
 * section every time.
 */
export const promoteNotes = (options: {
  stagingBody: string;
  sinceStaging: readonly Commit[];
}): string => {
  const { stagingBody, sinceStaging } = options;
  const base = stagingBody.split(SINCE_STAGING_HEADING)[0]?.trimEnd() ?? '';
  const extra = sinceStaging.filter((commit) => !isNoiseCommit(commit.subject));
  if (extra.length === 0) {
    return base;
  }
  return `${base}\n\n${SINCE_STAGING_HEADING}\n\n${renderNotes(extra)
    .split('\n')
    .filter((line) => !line.startsWith('### '))
    .join('\n')
    .trim()}`;
};

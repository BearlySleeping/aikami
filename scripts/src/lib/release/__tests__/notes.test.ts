// scripts/src/lib/release/__tests__/notes.test.ts

import { describe, expect, test } from 'bun:test';
import {
  type Commit,
  isNoiseCommit,
  parseCommitSubject,
  promoteNotes,
  renderNotes,
  SINCE_STAGING_HEADING,
} from '../notes.ts';

const commit = (subject: string, sha = 'abc1234'): Commit => ({ sha, subject });

describe('parseCommitSubject', () => {
  test('splits type, scope and description', () => {
    expect(parseCommitSubject('feat(engine): add fog')).toEqual({
      type: 'feat',
      scope: 'engine',
      description: 'add fog',
    });
  });

  test('handles a breaking-change marker and a missing scope', () => {
    expect(parseCommitSubject('fix!: drop legacy saves')).toEqual({
      type: 'fix',
      scope: null,
      description: 'drop legacy saves',
    });
  });

  test('keeps a non-conventional subject instead of dropping it', () => {
    expect(parseCommitSubject('Bump the thing')).toEqual({
      type: null,
      scope: null,
      description: 'Bump the thing',
    });
  });
});

describe('isNoiseCommit', () => {
  test('flags merges and the release bump this CLI itself creates', () => {
    expect(isNoiseCommit('Merge branch main into staging')).toBe(true);
    expect(isNoiseCommit('Merge pull request #267 from x')).toBe(true);
    expect(isNoiseCommit('chore(release): v0.2.0')).toBe(true);
    expect(isNoiseCommit('feat: real work')).toBe(false);
  });
});

describe('renderNotes', () => {
  test('groups by type in a fixed order and scopes the bullets', () => {
    const body = renderNotes([
      commit('fix(auth): stop double sign-in'),
      commit('feat(engine): add fog'),
      commit('perf: faster boot'),
    ]);
    expect(body.indexOf('✨ Features')).toBeLessThan(body.indexOf('🐛 Fixes'));
    expect(body.indexOf('🐛 Fixes')).toBeLessThan(body.indexOf('⚡ Performance'));
    expect(body).toContain('- **engine**: add fog');
    expect(body).toContain('- faster boot');
  });

  test('drops repo-only work that no player can observe', () => {
    const body = renderNotes([commit('chore: bump deps'), commit('ci: retry flaky job')]);
    expect(body).toBe('_No user-facing changes._');
  });

  test('drops the contract pipeline’s docs bookkeeping', () => {
    // `docs(contracts): C-NNN …` commits outnumber real changes several times
    // over on a realistic range — see the SECTIONS comment.
    const body = renderNotes([
      commit('docs(contracts): C-452 implement notes'),
      commit('docs(contracts): approve C-380'),
      commit('refactor: split the deploy planner'),
      commit('feat: add fog'),
    ]);
    expect(body).not.toContain('C-452');
    expect(body).not.toContain('deploy planner');
    expect(body).toContain('- add fog');
  });

  test('collapses a duplicate subject to one bullet', () => {
    // A squash-merged PR whose branch was also merged forward appears twice
    // in git log; listing it twice reads like it shipped twice.
    const body = renderNotes([commit('feat: add fog', 'aaa'), commit('feat: add fog', 'bbb')]);
    expect(body.match(/add fog/g)).toHaveLength(1);
  });

  test('keeps non-conventional commits under Other', () => {
    const body = renderNotes([commit('Bump the thing')]);
    expect(body).toContain('### Other');
    expect(body).toContain('- Bump the thing');
  });
});

describe('promoteNotes', () => {
  const stagingBody = '### ✨ Features\n\n- **engine**: add fog';

  test('carries the staging body verbatim when nothing landed after the cut', () => {
    expect(promoteNotes({ stagingBody, sinceStaging: [] })).toBe(stagingBody);
  });

  test('preserves hand-edited staging notes rather than regenerating them', () => {
    const edited = '## What players get\n\nFog, finally. Written by a human.';
    expect(promoteNotes({ stagingBody: edited, sinceStaging: [] })).toBe(edited);
  });

  test('appends post-cut commits under their own heading', () => {
    const body = promoteNotes({
      stagingBody,
      sinceStaging: [commit('fix: hotfix the crash')],
    });
    expect(body).toContain(stagingBody);
    expect(body).toContain(SINCE_STAGING_HEADING);
    expect(body).toContain('- hotfix the crash');
  });

  test('ignores noise-only commits after the cut', () => {
    const body = promoteNotes({
      stagingBody,
      sinceStaging: [commit('Merge branch staging into production')],
    });
    expect(body).toBe(stagingBody);
  });

  test('re-promoting replaces the tail instead of stacking a second one', () => {
    const once = promoteNotes({ stagingBody, sinceStaging: [commit('fix: a')] });
    const twice = promoteNotes({ stagingBody: once, sinceStaging: [commit('fix: a')] });
    expect(twice).toBe(once);
    expect(twice.match(new RegExp(SINCE_STAGING_HEADING, 'g'))).toHaveLength(1);
  });
});

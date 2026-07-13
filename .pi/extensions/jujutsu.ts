// .pi/extensions/jujutsu.ts
//
// Jujutsu (jj) VCS integration for pi — sync bookmarks, create new changes,
// and manage the working copy in a jj repo.
//
// Registered tools:
//   jj_sync       — Fetch from remote + update a bookmark to match origin
//   jj_new        — Create a new change on top of a bookmark or change

import { execSync } from 'node:child_process';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60_000;

/** Check if we're in a jj repo. */
function isJjRepo(): boolean {
  try {
    execSync('jj root', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/** Get the current change ID. */
function getCurrentChangeId(): string {
  return execSync('jj log -r @ --no-graph -T change_id', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Get the change ID a bookmark points to. */
function getBookmarkChangeId(bookmark: string): string {
  return execSync(`jj log -r 'bookmarks(${bookmark})' --no-graph -T change_id`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** Check if a bookmark exists. */
function bookmarkExists(bookmark: string): boolean {
  try {
    const out = execSync(`jj bookmark list --revisions 'bookmarks(${bookmark})'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ═══════════════════════════════════════════════════════════════════════
  // Tool 1: jj_sync
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'jj_sync',
    label: 'Jujutsu: Sync Bookmark',
    description:
      'Fetch from remote and update a jj bookmark to match its remote counterpart. ' +
      'Equivalent to `git pull` for a branch. Does NOT move your working copy (@) — ' +
      'use jj_new after sync to start fresh work on the updated bookmark.',
    promptSnippet: 'Use jj_sync to fetch and update a jj bookmark (equivalent to git pull)',
    promptGuidelines: [
      'Use jj_sync after a PR merge to update a local bookmark like "dev" or "main".',
      'jj_sync moves the bookmark pointer, but does NOT move @. Call jj_new after to move your working copy.',
      'If conflicts arise (divergent changes), they are reported for manual resolution.',
    ],
    parameters: Type.Object({
      bookmark: Type.String({
        description: 'Bookmark name to sync (e.g. "dev", "main")',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isJjRepo()) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ Not a jj repository. Use gh CLI / git tools for non-jj repos.',
            },
          ],
          isError: true,
          details: {},
        };
      }

      const bookmark = params.bookmark;

      if (!bookmarkExists(bookmark)) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Bookmark \`${bookmark}\` does not exist locally.`,
            },
          ],
          isError: true,
          details: { bookmark },
        };
      }

      // Step 1: Fetch from remote
      const fetchResult = await pi.exec('jj', ['git', 'fetch'], {
        timeout: DEFAULT_TIMEOUT,
        cwd: ctx.cwd,
      });

      if (fetchResult.code !== 0) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to fetch from remote: ${fetchResult.stderr || fetchResult.stdout}`,
            },
          ],
          isError: true,
          details: { bookmark },
        };
      }

      // Step 2: Check where the remote tracking points
      let originChangeId: string;
      try {
        // jj tracks remote bookmarks separately — parse from bookmark list
        const remoteList = execSync(
          `jj bookmark list --all`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ctx.cwd },
        );

        // Match: "dev@origin: msykvuuo 07815a23 ..."
        const remoteMatch = remoteList.match(
          new RegExp(`${bookmark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@origin:\\s+([a-z]{12,})\\s`),
        );
        if (!remoteMatch) {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Remote tracking for \`${bookmark}@origin\` not found. Has \`${bookmark}\` been pushed?`,
              },
            ],
            isError: true,
            details: { bookmark },
          };
        }
        originChangeId = remoteMatch[1];
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to read remote bookmark list: ${message}`,
            },
          ],
          isError: true,
          details: { bookmark },
        };
      }

      // Step 3: Get local bookmark's current change
      const localChangeId = getBookmarkChangeId(bookmark);

      if (localChangeId === originChangeId) {
        return {
          content: [
            {
              type: 'text',
              text: `✅ **\`${bookmark}\` is already up to date** with \`${bookmark}@origin\`.`,
            },
          ],
          details: { bookmark, localChangeId, originChangeId, synced: false, alreadyUpToDate: true },
        };
      }

      // Step 4: Move the bookmark to match the remote
      try {
        execSync(`jj bookmark set ${bookmark} -r ${originChangeId}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: ctx.cwd,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        // Check if this is a conflict (divergent changes)
        if (message.includes('divergent') || message.includes('conflict')) {
          return {
            content: [
              {
                type: 'text',
                text: [
                  `⚠️ **Divergent changes detected** on \`${bookmark}\`.`,
                  '',
                  `The local and remote bookmarks have diverged. This means someone`,
                  `pushed changes to \`${bookmark}\` that conflict with local changes.`,
                  '',
                  '**To resolve:**',
                  `  1. \`jj_new\` with base="${bookmark}" — start fresh on ${bookmark}`,
                  `  2. Bring in your local changes: \`jj squash --from <your-change-id>\``,
                  `  3. Or abandon local: \`jj abandon 'bookmarks(${bookmark})'\``,
                ].join('\n'),
              },
            ],
            isError: true,
            details: { bookmark, divergent: true },
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to update bookmark \`${bookmark}\`: ${message}`,
            },
          ],
          isError: true,
          details: { bookmark },
        };
      }

      // Get a short log of what changed
      let logSummary = '';
      try {
        logSummary = execSync(
          `jj log -r '${originChangeId} & ::bookmarks(${bookmark}) & ~::${localChangeId}' --no-graph -T '  ◆ commit_id.short() ++ " " ++ description.first_line() ++ "\\n"'`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ctx.cwd },
        ).trim();
      } catch {
        // Non-essential
      }

      const currentChangeId = getCurrentChangeId();
      const atIsOnBookmark =
        currentChangeId === localChangeId ||
        (() => {
          try {
            execSync(`jj log -r '@ & ::bookmarks(${bookmark})' --no-graph`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: ctx.cwd,
            });
            return true;
          } catch {
            return false;
          }
        })();

      const moveHint = atIsOnBookmark
        ? `\n\n💡 Your working copy (@) is based on the old \`${bookmark}\` tip. ` +
          `Run \`jj_new\` with base="${bookmark}" to move to the updated tip.`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ **\`${bookmark}\` synced** with \`${bookmark}@origin\`.`,
              '',
              `**Old tip:** \`${localChangeId.slice(0, 12)}\``,
              `**New tip:** \`${originChangeId.slice(0, 12)}\``,
              logSummary ? `\n**New changes:**\n${logSummary}` : '',
              moveHint,
            ].join('\n'),
          },
        ],
        details: {
          bookmark,
          localChangeId,
          originChangeId,
          synced: true,
          workingCopyNeedsMove: atIsOnBookmark,
        },
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Tool 2: jj_new
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerTool({
    name: 'jj_new',
    label: 'Jujutsu: New Change',
    description:
      'Create a new change on top of a jj bookmark or change ID. ' +
      'Equivalent to `git checkout -b` — starts a new working copy ' +
      'based on the given base. The previous working copy is preserved.',
    promptSnippet: 'Use jj_new to start fresh work on a bookmark (like git checkout)',
    promptGuidelines: [
      'Use jj_new to move your working copy to a bookmark after syncing with jj_sync.',
      'The base defaults to "dev" but can be any bookmark or change ID.',
      'The previous working copy is preserved — jj never loses work.',
      'Set message to describe what you plan to work on.',
    ],
    parameters: Type.Object({
      base: Type.Optional(
        Type.String({
          default: 'dev',
          description: 'Bookmark or change ID to base the new change on (default: "dev")',
        }),
      ),
      message: Type.Optional(
        Type.String({
          description: 'Description for the new change',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isJjRepo()) {
        return {
          content: [
            {
              type: 'text',
              text: '❌ Not a jj repository.',
            },
          ],
          isError: true,
          details: {},
        };
      }

      const base = params.base ?? 'dev';

      // Resolve the base to a revset
      let revset: string;
      if (/^[a-z]{12,}$/.test(base)) {
        // Looks like a change ID
        revset = base;
      } else if (bookmarkExists(base)) {
        revset = `bookmarks(${base})`;
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Bookmark or change \`${base}\` not found.`,
            },
          ],
          isError: true,
          details: { base },
        };
      }

      try {
        const msgFlag = params.message ? `-m "${params.message.replace(/"/g, '\\"')}"` : '';
        execSync(`jj new '${revset}' ${msgFlag}`.trim(), {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: ctx.cwd,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Failed to create new change: ${message}`,
            },
          ],
          isError: true,
          details: { base, revset },
        };
      }

      const newChangeId = getCurrentChangeId();
      let parentInfo = '';
      try {
        parentInfo = execSync(`jj log -r '@-' --no-graph -T '  ◆ commit_id.short() ++ " " ++ description.first_line()'`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: ctx.cwd,
        }).trim();
      } catch {
        // Non-essential
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `✅ **New change created** on \`${base}\`.`,
              '',
              `**New change:** \`${newChangeId}\``,
              params.message ? `**Message:** ${params.message}` : '',
              parentInfo ? `\n**Parent:**\n${parentInfo}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        details: {
          changeId: newChangeId,
          base,
          message: params.message,
        },
      };
    },
  });
}

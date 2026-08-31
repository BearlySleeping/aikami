// packages/shared/constants/src/lib/discord.ts
//
// Non-sensitive Discord snowflakes (guild/channel/role/forum-tag ids) — plain
// constants rather than Secret Manager fetches, same reasoning as
// DISCORD_GUILD_ID sitting unencrypted in scripts/.env.example: a
// channel/role id isn't a credential.
//
// SOURCE OF TRUTH is scripts/src/lib/discord/structure.ts — this file is a
// generated-by-hand mirror of the ids that structure.ts's names resolve to
// live. Update it whenever a sync changes a relevant id (renames don't
// change the id; creating/recreating a channel or role does). Both
// `packages/backend/discord-bot` and `scripts/src/lib/discord/` import from
// here instead of keeping their own copies (C-449 AC-5 follow-up —
// CLAUDE.md forbids duplicating this kind of shared reference data across
// package boundaries).

export const DISCORD_GUILD_ID = '1326946946136408064';

export const DISCORD_ROLES = {
  admin: '1538729969004449882',
  moderator: '1538729970522652684',
  contributor: '1538729972204703845',
} as const;

export const DISCORD_CHANNELS = {
  announcements: '1326946947415806074',
  releases: '1536405075814260896',
  releasesStaging: '1536405159092027512',
  // Renamed from "bugs-features-requests" to "support" (Task 1); the id is
  // unchanged by a rename.
  support: '1538878867962466364',
  // Renamed from "moderator-only" to "staff" (Task 1); the id is unchanged.
  staff: '1536406570882174980',
  // TODO: not live yet — created by TASK 2's structure.ts sync (`#dev`,
  // `#pull-requests`, `#merged` under the new "Developers" category). Fill
  // these in with `bun run scripts -- discord audit` once that sync has run.
  pullRequests: '',
  merged: '',
} as const;

export const DISCORD_FORUM_TAG_LABELS: Record<string, string> = {
  '1538881560181211219': 'bug', // Bug
  '1538881560181211220': 'enhancement', // Feature Request
  // "Question" (1538881560181211221) intentionally has no GitHub label —
  // most questions never become an issue. Same for the TASK 2 additions
  // "Content" and "Solved" — neither maps to a GitHub label either.
};

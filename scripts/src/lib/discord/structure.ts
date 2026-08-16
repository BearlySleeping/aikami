// scripts/src/lib/discord/structure.ts
//
// Declarative desired state for the Aikami Discord server — the single
// source of truth `sync.ts` reconciles the live guild against. Edit this
// file and run a sync instead of clicking around in Discord, so the server
// layout is reviewable in git like any other config.
//
// Bootstrapping from an existing server: run
//   bun run scripts -- discord/index.ts audit --format=structure
// to print a paste-ready seed built from what's live right now, then trim
// it down to what you actually want to manage declaratively.
//
// Matching: categories/channels/roles are matched to live Discord objects
// BY NAME (case-sensitive). Renaming something here creates a new one and
// leaves the old one dangling — rename in Discord first (or via `sync
// --apply`, which only ever creates/updates) then update the name here.
//
// Safety: `sync --apply` only ever CREATES or UPDATES. Nothing declared
// here (or removed from here) ever deletes a live channel/role unless you
// also pass `--prune` — see sync.ts.

export type DesiredRole = {
  name: string;
  /** 0xRRGGBB, e.g. 0x6d28d9. Omit for Discord's default (no color). */
  color?: number;
  /** Show this role's members separately in the member list. */
  hoist?: boolean;
  /** Allow anyone to @mention this role. */
  mentionable?: boolean;
  /** Permission bitfield as a string, e.g. "0" for no permissions. */
  permissions?: string;
};

export type DesiredChannelType = 'text' | 'voice' | 'announcement' | 'forum' | 'stage';

export type DesiredChannel = {
  name: string;
  type: DesiredChannelType;
  /** Must match a DesiredCategory.name below, or omit for top-level. */
  category?: string;
  topic?: string;
  nsfw?: boolean;
};

export type DesiredCategory = {
  name: string;
};

export type DesiredStructure = {
  roles: DesiredRole[];
  categories: DesiredCategory[];
  channels: DesiredChannel[];
};

// ─── Edit below this line ───────────────────────────────────────────────
// Empty on purpose — an empty structure is treated as "not configured yet"
// by sync.ts and refuses to --prune, so filling this in incrementally is
// safe. Seed it with the `audit --format=structure` command above.

export const structure: DesiredStructure = {
  roles: [],
  categories: [],
  channels: [],
};

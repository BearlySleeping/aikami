// scripts/src/lib/discord/types.ts
//
// Minimal local shapes for the subset of the Discord API this module
// touches. discord-api-types models channels as a deep discriminated union
// keyed on `type` (text/voice/forum/thread/... each with different fields),
// which is accurate but painful for generic CRUD helpers that only read/
// write a handful of common fields (name, parent_id, topic, nsfw).
// @discordjs/rest's request body is untyped (`unknown`) regardless, so
// there's no type-safety lost by keeping our own narrower shape here
// instead of fighting the full union.

export type PermissionOverwrite = { id: string; type: 0 | 1; allow: string; deny: string };

export type GuildChannel = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  topic?: string | null;
  nsfw?: boolean;
  position?: number;
  permission_overwrites?: PermissionOverwrite[];
};

export type GuildRole = {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
  /** Integration-managed (bot roles, etc.) — outside declarative
   *  synchronization: the structure seed filters these out so they never
   *  enter generated sync plans (Discord forbids editing them). */
  managed?: boolean;
};

export type ChannelCreateBody = {
  name: string;
  type: number;
  parent_id?: string;
  topic?: string;
  nsfw?: boolean;
  permission_overwrites?: PermissionOverwrite[];
};

export type ChannelUpdateBody = Partial<Omit<ChannelCreateBody, 'name' | 'parent_id'>> & {
  /** Null moves a categorized channel to the top level; OMITTING parent_id
   *  leaves the channel where it is. The update payload must permit null so
   *  a planned top-level move can actually be applied. */
  parent_id?: string | null;
};

export type RoleCreateBody = {
  name: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string;
};

export type RoleUpdateBody = Partial<RoleCreateBody>;

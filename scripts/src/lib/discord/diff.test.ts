// scripts/src/lib/discord/diff.test.ts
//
// Category-resolution coverage for computePlan: top-level moves, categories
// created during the same sync, invalid category references, and no-op
// matching. Plus the type-change guard, position/forum diffing added
// alongside structure.ts's TASK 2 extension. diff.ts is pure (no I/O), so
// these run without any network.

import { describe, expect, it } from 'bun:test';
import { ChannelType, GuildVerificationLevel } from 'discord-api-types/v10';
import { computePlan, type LiveState } from './diff';
import type { DesiredCategory, DesiredChannel, DesiredRole } from './structure';
import type { AutoModRule, GuildChannel, GuildSettings } from './types';

const category = (id: string, name: string): GuildChannel => ({
  id,
  name,
  type: ChannelType.GuildCategory,
});

const textChannel = (id: string, name: string, parentId?: string): GuildChannel => ({
  id,
  name,
  type: ChannelType.GuildText,
  ...(parentId ? { parent_id: parentId } : {}),
});

const structure = (
  categories: DesiredCategory[],
  channels: DesiredChannel[],
  roles: DesiredRole[] = [],
) => ({ roles, categories, channels });

const FAKE_GUILD: GuildSettings = {
  id: 'g1',
  verification_level: 0,
  mfa_level: 0,
  explicit_content_filter: 0,
  rules_channel_id: null,
  public_updates_channel_id: null,
  safety_alerts_channel_id: null,
  system_channel_id: null,
  description: null,
};

/** Fills in the guild/automodRules boilerplate every LiveState needs but most tests don't care about. */
const live = (
  channels: GuildChannel[],
  roles: LiveState['roles'],
  overrides: Partial<Pick<LiveState, 'guild' | 'automodRules'>> = {},
): LiveState => ({
  channels,
  roles,
  guild: overrides.guild ?? FAKE_GUILD,
  automodRules: overrides.automodRules ?? [],
});

describe('computePlan — channel category handling', () => {
  it('plans moving a categorized channel to the top level', () => {
    // Desired state drops the category; the live channel still sits inside
    // the (also declared) "General" category. The move must be planned —
    // applied with parent_id: null, since omitting it would leave the
    // channel where it is.
    const plan = computePlan(
      structure([{ name: 'General' }], [{ name: 'announcements', type: 'text' }]),
      live([category('c1', 'General'), textChannel('t1', 'announcements', 'c1')], []),
    );
    expect(plan.updateChannels).toHaveLength(1);
    expect(plan.updateChannels[0]?.changes).toContain('category → top level');
  });

  it('resolves a category created during the same sync (declared but not live)', () => {
    // "New Cat" is declared in structure.categories but does not exist live
    // yet — it will be created earlier in the same sync. The channel exists
    // and is currently uncategorized, so an update into the new category
    // must be planned (not silently treated as a top-level move).
    const plan = computePlan(
      structure([{ name: 'New Cat' }], [{ name: 'room', type: 'text', category: 'New Cat' }]),
      live([textChannel('t1', 'room')], []),
    );
    expect(plan.updateChannels).toHaveLength(1);
    expect(plan.updateChannels[0]?.changes.some((c) => c.includes('New Cat'))).toBe(true);
    expect(plan.updateChannels[0]?.changes[0]).toContain('created this sync');
  });

  it('accepts a live category that is also declared (no phantom change)', () => {
    const plan = computePlan(
      structure([{ name: 'General' }], [{ name: 'room', type: 'text', category: 'General' }]),
      live([category('c1', 'General'), textChannel('t1', 'room', 'c1')], []),
    );
    expect(plan.updateChannels).toHaveLength(0);
    expect(plan.createChannels).toHaveLength(0);
  });

  it('throws on a channel.category that is neither live nor declared', () => {
    // A typo'd category name must fail loudly instead of silently becoming a
    // top-level move (the old `?? null` fallback conflated the two).
    expect(() =>
      computePlan(
        structure([], [{ name: 'room', type: 'text', category: 'Nope' }]),
        live([textChannel('t1', 'room')], []),
      ),
    ).toThrow(/Nope/);
  });

  it('throws on an invalid category reference even when the channel itself is new', () => {
    expect(() =>
      computePlan(
        structure([], [{ name: 'brand-new', type: 'text', category: 'Missing' }]),
        live([], []),
      ),
    ).toThrow(/Missing/);
  });
});

describe('computePlan — channel permission overwrites', () => {
  const everyone: DesiredRole = { name: '@everyone', permissions: '0' };
  const guildRole = (id: string, name: string) => ({
    id,
    name,
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: '0',
    position: 0,
  });

  it('plans an update when a declared overwrite differs from live', () => {
    const plan = computePlan(
      structure(
        [],
        [
          {
            name: 'mod-only',
            type: 'text',
            permissionOverwrites: [{ role: '@everyone', deny: ['ViewChannel'] }],
          },
        ],
        [everyone],
      ),
      live(
        [{ ...textChannel('t1', 'mod-only'), permission_overwrites: [] }],
        [guildRole('g1', '@everyone')],
      ),
    );
    expect(plan.updateChannels).toHaveLength(1);
    expect(plan.updateChannels[0]?.changes).toContain('permissions changed');
  });

  it('reports no change when live overwrites already match by role name', () => {
    const plan = computePlan(
      structure(
        [],
        [
          {
            name: 'mod-only',
            type: 'text',
            permissionOverwrites: [{ role: '@everyone', deny: ['ViewChannel'] }],
          },
        ],
        [everyone],
      ),
      live(
        [
          {
            ...textChannel('t1', 'mod-only'),
            permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: '1024' }],
          },
        ],
        [guildRole('g1', '@everyone')],
      ),
    );
    expect(plan.updateChannels).toHaveLength(0);
  });

  it('leaves a channel with no declared overwrites untouched even if live has some', () => {
    const plan = computePlan(
      structure([], [{ name: 'general', type: 'text' }], [everyone]),
      live(
        [
          {
            ...textChannel('t1', 'general'),
            permission_overwrites: [{ id: 'g1', type: 0, allow: '0', deny: '1024' }],
          },
        ],
        [guildRole('g1', '@everyone')],
      ),
    );
    expect(plan.updateChannels).toHaveLength(0);
  });
});

describe('computePlan — impossible channel type change guard', () => {
  it('throws at plan time on a type change PATCH cannot perform (text → forum)', () => {
    expect(() =>
      computePlan(
        structure([], [{ name: 'support', type: 'forum' }]),
        live([textChannel('t1', 'support')], []),
      ),
    ).toThrow(/support.*cannot change type/i);
  });

  it('allows the text ↔ announcement conversion PATCH does support', () => {
    const plan = computePlan(
      structure([], [{ name: 'releases', type: 'announcement' }]),
      live([textChannel('t1', 'releases')], []),
    );
    expect(plan.updateChannels).toHaveLength(1);
    expect(plan.updateChannels[0]?.changes.some((c) => c.startsWith('type '))).toBe(true);
  });
});

describe('computePlan — voice/stage channels have no topic field', () => {
  it('never plans a topic change for a voice channel, even when declared', () => {
    // Discord rejects ANY string sent as a voice channel's topic
    // (CHANNEL_TOPIC_INVALID, confirmed live) — declaring one in
    // structure.ts is documentation only, never sent or diffed.
    const plan = computePlan(
      structure([], [{ name: 'Lounge', type: 'voice', topic: 'TODO(copy): lounge topic.' }]),
      live([{ ...textChannel('v1', 'Lounge'), type: ChannelType.GuildVoice }], []),
    );
    expect(plan.updateChannels).toHaveLength(0);
  });
});

describe('computePlan — position diffing', () => {
  const guildRole = (id: string, name: string, position: number) => ({
    id,
    name,
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: '0',
    position,
  });

  it('reassigns role positions to the live slots the declared set already owns', () => {
    // Declared highest-first: Admin, Moderator. Live has them backwards
    // (Moderator above Admin) — the two positions (5 and 3) must swap
    // between exactly these two roles, untouched by anything else.
    const plan = computePlan(
      structure([], [], [{ name: 'Admin' }, { name: 'Moderator' }]),
      live([], [guildRole('r1', 'Admin', 3), guildRole('r2', 'Moderator', 5)]),
    );
    expect(plan.roleReorders).toEqual(
      expect.arrayContaining([
        { id: 'r1', name: 'Admin', from: 3, to: 5 },
        { id: 'r2', name: 'Moderator', from: 5, to: 3 },
      ]),
    );
  });

  it('plans no role reorder when live order already matches declared order', () => {
    const plan = computePlan(
      structure([], [], [{ name: 'Admin' }, { name: 'Moderator' }]),
      live([], [guildRole('r1', 'Admin', 5), guildRole('r2', 'Moderator', 3)]),
    );
    expect(plan.roleReorders).toHaveLength(0);
  });

  it('reassigns channel positions only among siblings in the same category', () => {
    let externalPositionReads = 0;
    const externalChannel: GuildChannel = {
      ...textChannel('t3', 'external', 'c2'),
      get position() {
        externalPositionReads += 1;
        return 99;
      },
    };
    const plan = computePlan(
      structure(
        [{ name: 'Cat' }],
        [
          { name: 'a', type: 'text', category: 'Cat' },
          { name: 'b', type: 'text', category: 'Cat' },
        ],
      ),
      live(
        [
          category('c1', 'Cat'),
          category('c2', 'Other'),
          { ...textChannel('t1', 'a', 'c1'), position: 1 },
          { ...textChannel('t2', 'b', 'c1'), position: 0 },
          externalChannel,
        ],
        [],
      ),
    );
    expect(plan.channelReorders).toHaveLength(2);
    expect(plan.channelReorders).toEqual([
      { id: 't1', name: 'a', from: 1, to: 0 },
      { id: 't2', name: 'b', from: 0, to: 1 },
    ]);
    expect(externalPositionReads).toBe(0);
    expect(plan.channelReorders.some((change) => change.id === externalChannel.id)).toBe(false);
  });
});

describe('computePlan — guild and management boundaries', () => {
  it('plans a declared guild settings change', () => {
    const plan = computePlan(
      {
        ...structure([], []),
        guild: { verificationLevel: GuildVerificationLevel.Medium },
      },
      live([], []),
    );
    expect(plan.guildUpdate?.body.verification_level).toBe(GuildVerificationLevel.Medium);
    expect(plan.guildUpdate?.changes).toContain('verificationLevel 0 → 2');
  });

  it('throws when guild.rulesChannel cannot be resolved live', () => {
    expect(() =>
      computePlan(
        {
          ...structure([], []),
          guild: { rulesChannel: 'missing-rules' },
        },
        live([], []),
      ),
    ).toThrow(/guild\.rulesChannel.*missing-rules/i);
  });

  it('plans deletion of an undeclared live AutoMod rule when automod is explicitly empty', () => {
    const liveRule: AutoModRule = {
      id: 'rule1',
      guild_id: 'g1',
      name: 'Unmanaged rule',
      event_type: 1,
      trigger_type: 3,
      trigger_metadata: {},
      actions: [],
      enabled: true,
      exempt_roles: [],
      exempt_channels: [],
    };
    const plan = computePlan(
      { ...structure([], []), automod: [] },
      live([], [], { automodRules: [liveRule] }),
    );
    expect(plan.deleteAutomodRules).toEqual([{ id: 'rule1', name: 'Unmanaged rule' }]);
  });

  it('leaves live AutoMod rules unmanaged when automod is absent', () => {
    const liveRule: AutoModRule = {
      id: 'rule1',
      guild_id: 'g1',
      name: 'Unmanaged rule',
      event_type: 1,
      trigger_type: 3,
      trigger_metadata: {},
      actions: [],
      enabled: true,
      exempt_roles: [],
      exempt_channels: [],
    };
    const plan = computePlan(structure([], []), live([], [], { automodRules: [liveRule] }));
    expect(plan.deleteAutomodRules).toHaveLength(0);
    expect(plan.updateAutomodRules).toHaveLength(0);
    expect(plan.createAutomodRules).toHaveLength(0);
  });
});

describe('computePlan — forum diffing', () => {
  const forumChannel = (
    id: string,
    name: string,
    overrides: Partial<GuildChannel> = {},
  ): GuildChannel => ({
    id,
    name,
    type: ChannelType.GuildForum,
    available_tags: [],
    default_reaction_emoji: null,
    default_forum_layout: 0,
    default_sort_order: 0,
    ...overrides,
  });

  it('plans an update when a declared forum tag is missing live', () => {
    const plan = computePlan(
      structure([], [{ name: 'support', type: 'forum', forum: { tags: [{ name: 'Bug' }] } }]),
      live([forumChannel('f1', 'support')], []),
    );
    expect(plan.updateChannels).toHaveLength(1);
    expect(plan.updateChannels[0]?.changes).toContain('forum tags changed');
  });

  it('reports no change when live forum tags already match by name/moderated/emoji', () => {
    const plan = computePlan(
      structure(
        [],
        [
          {
            name: 'support',
            type: 'forum',
            forum: {
              tags: [{ name: 'Bug' }, { name: 'Solved', moderated: true, emojiName: '✅' }],
            },
          },
        ],
      ),
      live(
        [
          forumChannel('f1', 'support', {
            available_tags: [
              { id: '1', name: 'Bug', moderated: false, emoji_id: null, emoji_name: null },
              { id: '2', name: 'Solved', moderated: true, emoji_id: null, emoji_name: '✅' },
            ],
          }),
        ],
        [],
      ),
    );
    expect(plan.updateChannels).toHaveLength(0);
  });

  it('diffs default reaction, layout, and sort order', () => {
    const plan = computePlan(
      structure(
        [],
        [
          {
            name: 'support',
            type: 'forum',
            forum: {
              tags: [],
              defaultReaction: '👍',
              defaultLayout: 'gallery',
              defaultSortOrder: 'creationDate',
            },
          },
        ],
      ),
      live([forumChannel('f1', 'support')], []),
    );
    expect(plan.updateChannels).toHaveLength(1);
    const changes = plan.updateChannels[0]?.changes ?? [];
    expect(changes.some((c) => c.includes('forum default reaction'))).toBe(true);
    expect(changes.some((c) => c.includes('forum layout'))).toBe(true);
    expect(changes.some((c) => c.includes('forum sort order'))).toBe(true);
  });

  it('uses forum.postGuidelines as the topic instead of channel.topic', () => {
    const plan = computePlan(
      structure(
        [],
        [
          {
            name: 'support',
            type: 'forum',
            topic: 'ignored',
            forum: { tags: [], postGuidelines: 'read this first' },
          },
        ],
      ),
      live([forumChannel('f1', 'support', { topic: null })], []),
    );
    expect(plan.updateChannels).toHaveLength(1);
    expect(plan.updateChannels[0]?.changes).toContain('topic → "read this first"');
  });
});

describe('computePlan — AutoMod', () => {
  it('diffs the declared enabled state and exempt channels', () => {
    const liveRule: AutoModRule = {
      id: 'rule1',
      guild_id: 'g1',
      name: 'Spam',
      event_type: 1,
      trigger_type: 3,
      trigger_metadata: {},
      actions: [{ type: 2, metadata: { channel_id: 'staff-id' } }],
      enabled: true,
      exempt_roles: [],
      exempt_channels: [],
    };
    const plan = computePlan(
      {
        roles: [],
        categories: [],
        channels: [
          { name: 'staff', type: 'text' },
          { name: 'general', type: 'text' },
        ],
        automod: [
          {
            name: 'Spam',
            trigger: 'spam',
            enabled: false,
            exemptChannels: ['general'],
            actions: [{ type: 'alert', channel: 'staff' }],
          },
        ],
      },
      live([textChannel('staff-id', 'staff'), textChannel('general-id', 'general')], [], {
        automodRules: [liveRule],
      }),
    );
    expect(plan.updateAutomodRules[0]?.changes).toContain('enabled true → false');
    expect(plan.updateAutomodRules[0]?.changes).toContain('exempt channels changed');
    expect(plan.updateAutomodRules[0]?.body.exempt_channels).toEqual(['general-id']);
  });

  it('distinguishes a declared exempt role that is not live from an undeclared role', () => {
    const desiredRule = {
      name: 'Spam',
      trigger: 'spam' as const,
      exemptRoles: ['Moderator'],
      actions: [{ type: 'alert' as const, channel: 'staff' }],
    };
    expect(() =>
      computePlan(
        {
          roles: [{ name: 'Moderator' }],
          categories: [],
          channels: [{ name: 'staff', type: 'text' }],
          automod: [desiredRule],
        },
        live([textChannel('staff-id', 'staff')], []),
      ),
    ).toThrow(/declared.*must exist live first/i);
    expect(() =>
      computePlan(
        {
          roles: [],
          categories: [],
          channels: [{ name: 'staff', type: 'text' }],
          automod: [desiredRule],
        },
        live([textChannel('staff-id', 'staff')], []),
      ),
    ).toThrow(/not declared in structure\.roles/i);
  });

  it('reuses an existing rule matched by name instead of creating a duplicate, and diffs changed metadata', () => {
    const liveRule: AutoModRule = {
      id: 'rule1',
      guild_id: 'g1',
      name: 'Block Mention Spam',
      event_type: 1,
      trigger_type: 5, // MentionSpam
      trigger_metadata: { mention_total_limit: 20, mention_raid_protection_enabled: true },
      actions: [{ type: 2, metadata: { channel_id: 'staff-id' } }],
      enabled: true,
      exempt_roles: [],
      exempt_channels: [],
    };
    const plan = computePlan(
      {
        roles: [],
        categories: [],
        channels: [{ name: 'staff', type: 'text' }],
        automod: [
          {
            name: 'Block Mention Spam',
            trigger: 'mentionSpam',
            mentionTotalLimit: 8,
            mentionRaidProtection: true,
            actions: [{ type: 'alert', channel: 'staff' }],
          },
        ],
      },
      live([textChannel('staff-id', 'staff')], [], { automodRules: [liveRule] }),
    );
    expect(plan.createAutomodRules).toHaveLength(0);
    expect(plan.updateAutomodRules).toHaveLength(1);
    expect(plan.updateAutomodRules[0]?.changes).toContain('trigger metadata changed');
  });

  it('does not report drift for keyword_filter/presets/regex_patterns/allow_list Discord echoes as [] but we never declared', () => {
    // Discord always echoes these back as [] on a live rule even when never
    // sent — without canonicalizing both sides before comparison this would
    // show as permanent "trigger metadata changed" noise on every diff/sync.
    const liveRule: AutoModRule = {
      id: 'rule1',
      guild_id: 'g1',
      name: 'Blocked Keyword Presets',
      event_type: 1,
      trigger_type: 4, // KeywordPreset
      trigger_metadata: {
        presets: [2, 3],
        keyword_filter: [],
        regex_patterns: [],
        allow_list: [],
      },
      actions: [{ type: 2, metadata: { channel_id: 'staff-id' } }],
      enabled: true,
      exempt_roles: [],
      exempt_channels: [],
    };
    const plan = computePlan(
      {
        roles: [],
        categories: [],
        channels: [{ name: 'staff', type: 'text' }],
        automod: [
          {
            name: 'Blocked Keyword Presets',
            trigger: 'keywordPreset',
            presets: ['sexualContent', 'slurs'],
            actions: [{ type: 'alert', channel: 'staff' }],
          },
        ],
      },
      live([textChannel('staff-id', 'staff')], [], { automodRules: [liveRule] }),
    );
    expect(plan.updateAutomodRules).toHaveLength(0);
  });
});

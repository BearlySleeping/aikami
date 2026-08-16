// scripts/src/lib/discord/diff.test.ts
//
// Category-resolution coverage for computePlan: top-level moves, categories
// created during the same sync, invalid category references, and no-op
// matching. diff.ts is pure (no I/O), so these run without any network.

import { describe, expect, it } from 'bun:test';
import { ChannelType } from 'discord-api-types/v10';
import { computePlan } from './diff';
import type { DesiredCategory, DesiredChannel, DesiredRole } from './structure';
import type { GuildChannel } from './types';

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

describe('computePlan — channel category handling', () => {
  it('plans moving a categorized channel to the top level', () => {
    // Desired state drops the category; the live channel still sits inside
    // the (also declared) "General" category. The move must be planned —
    // applied with parent_id: null, since omitting it would leave the
    // channel where it is.
    const plan = computePlan(
      structure([{ name: 'General' }], [{ name: 'announcements', type: 'text' }]),
      {
        channels: [category('c1', 'General'), textChannel('t1', 'announcements', 'c1')],
        roles: [],
      },
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
      { channels: [textChannel('t1', 'room')], roles: [] },
    );
    expect(plan.updateChannels).toHaveLength(1);
    expect(plan.updateChannels[0]?.changes.some((c) => c.includes('New Cat'))).toBe(true);
    expect(plan.updateChannels[0]?.changes[0]).toContain('created this sync');
  });

  it('accepts a live category that is also declared (no phantom change)', () => {
    const plan = computePlan(
      structure([{ name: 'General' }], [{ name: 'room', type: 'text', category: 'General' }]),
      { channels: [category('c1', 'General'), textChannel('t1', 'room', 'c1')], roles: [] },
    );
    expect(plan.updateChannels).toHaveLength(0);
    expect(plan.createChannels).toHaveLength(0);
  });

  it('throws on a channel.category that is neither live nor declared', () => {
    // A typo'd category name must fail loudly instead of silently becoming a
    // top-level move (the old `?? null` fallback conflated the two).
    expect(() =>
      computePlan(structure([], [{ name: 'room', type: 'text', category: 'Nope' }]), {
        channels: [textChannel('t1', 'room')],
        roles: [],
      }),
    ).toThrow(/Nope/);
  });

  it('throws on an invalid category reference even when the channel itself is new', () => {
    expect(() =>
      computePlan(structure([], [{ name: 'brand-new', type: 'text', category: 'Missing' }]), {
        channels: [],
        roles: [],
      }),
    ).toThrow(/Missing/);
  });
});

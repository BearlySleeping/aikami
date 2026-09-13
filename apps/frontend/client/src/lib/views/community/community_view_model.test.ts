// apps/frontend/client/src/lib/views/community/community_view_model.test.ts
//
// C-513 AC-10: the community surface paints the assets this device already
// imported, from the local registry, with the hub unreachable.
//
// The library section is the whole offline proof: the browse list needs the
// hub, so a reload with networking blocked leaves it empty — the library rows
// are what still renders. These cases assert both halves, including that the
// library never consults the hub and never asks for a preview of an asset whose
// category cannot be painted.

import { describe, expect, test } from 'bun:test';
import type { CommunityAssetSummary } from '@aikami/types';
import {
  type CommunityCapabilities,
  type CommunityLibraryRow,
  createCommunityViewModel,
} from './community_view_model.svelte.ts';

const summary = (overrides: Partial<CommunityAssetSummary> = {}): CommunityAssetSummary => ({
  slug: 'tavern-theme',
  revision: 1,
  title: 'Tavern Theme',
  category: 'music',
  tag: 'music:community:tavern-theme',
  sha256: 'a'.repeat(64),
  ext: '.ogg',
  sizeBytes: 2048,
  provenance: { source: 'original', license: 'CC-BY-4.0' },
  license: 'CC-BY-4.0',
  moderationState: 'approved',
  isOwner: false,
  promoted: true,
  deliveryUrl: 'https://assets.test/assets/aa/aa.ogg',
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
  ...overrides,
});

type Harness = {
  capabilities: CommunityCapabilities;
  listed: () => number;
  previews: string[];
  libraryCalls: () => number;
};

const createHarness = (
  options: {
    library?: CommunityLibraryEntryLike[];
    libraryThrows?: boolean;
    listThrows?: boolean;
  } = {},
): Harness => {
  const previews: string[] = [];
  let listCalls = 0;
  let libraryCalls = 0;

  const capabilities: CommunityCapabilities = {
    ready: async () => undefined,
    list: async () => {
      listCalls += 1;
      if (options.listThrows) {
        throw new Error('hub unreachable');
      }
      return { items: [summary()] };
    },
    import: async (asset) => ({
      imported: true,
      tag: asset.tag,
      sha256: asset.sha256,
      unchanged: false,
    }),
    hubAvailable: () => !options.listThrows,
    listLibrary: async () => {
      libraryCalls += 1;
      if (options.libraryThrows) {
        throw new Error('registry unavailable');
      }
      return options.library ?? [];
    },
    resolvePreview: async (tag: string) => {
      previews.push(tag);
      return `blob:cached/${tag}`;
    },
  };

  return {
    capabilities,
    listed: () => listCalls,
    previews,
    libraryCalls: () => libraryCalls,
  };
};

type CommunityLibraryEntryLike = {
  tag: string;
  category: string;
  license?: string;
  attribution?: string;
};

const build = (harness: Harness) =>
  createCommunityViewModel({
    capabilities: harness.capabilities,
    className: 'CommunityViewModel',
  });

describe('C-513 AC-11: only resolvable collisions expose version actions', () => {
  test('a local-generated collision creates pending version state', async () => {
    const harness = createHarness();
    harness.capabilities.import = async (asset) => ({
      imported: false,
      tag: asset.tag,
      reason: 'tag_collision',
      collision: { kind: 'local-generated', existingHash: 'b'.repeat(64) },
    });
    const viewModel = build(harness);
    await viewModel.initialize();

    await viewModel.importAsset('music:community:tavern-theme');

    expect(viewModel.collisionTag).toBe('music:community:tavern-theme');
    expect(viewModel.collisionReason).toContain('locally generated');
    expect(viewModel.errorMessage).toBe('');
  });

  test('a non-versionable refusal surfaces an error without collision state', async () => {
    const harness = createHarness();
    harness.capabilities.import = async (asset) => ({
      imported: false,
      tag: asset.tag,
      reason: 'not_promoted',
    });
    const viewModel = build(harness);
    await viewModel.initialize();

    await viewModel.importAsset('music:community:tavern-theme');

    expect(viewModel.collisionTag).toBe('');
    expect(viewModel.collisionReason).toBe('');
    expect(viewModel.errorMessage).toContain('not been approved');
  });
});

describe('C-513 AC-10: the library section is the offline half', () => {
  test('imported assets render from the registry with the hub unreachable', async () => {
    const harness = createHarness({
      listThrows: true,
      library: [
        {
          tag: 'sprites:community:guild-banner',
          category: 'sprites',
          license: 'CC-BY-4.0',
          attribution: 'original',
        },
      ],
    });

    const viewModel = build(harness);
    await viewModel.initialize();

    // The hub call failed …
    expect(viewModel.errorMessage).toContain('hub unreachable');
    expect(viewModel.rows).toHaveLength(0);

    // … and the imported asset still paints, from the cache.
    expect(viewModel.hasLibrary).toBe(true);
    const row = viewModel.libraryRows[0] as CommunityLibraryRow;
    expect(row.tag).toBe('sprites:community:guild-banner');
    expect(row.isImage).toBe(true);
    expect(row.previewUrl).toBe('blob:cached/sprites:community:guild-banner');
    expect(row.licenseLabel).toBe('CC-BY-4.0');
    expect(row.attributionLabel).toBe('original');
  });

  test('audio imports are listed but never asked for a preview URL', async () => {
    const harness = createHarness({
      library: [{ tag: 'music:community:tavern-theme', category: 'music' }],
    });

    const viewModel = build(harness);
    await viewModel.initialize();

    const row = viewModel.libraryRows[0] as CommunityLibraryRow;
    expect(row.isImage).toBe(false);
    expect(row.previewUrl).toBe('');
    // No image tag is rendered for audio, so no resolve is attempted.
    expect(harness.previews).toEqual([]);
  });

  test('the library never consults the hub', async () => {
    const harness = createHarness({
      library: [{ tag: 'music:community:tavern-theme', category: 'music' }],
    });

    const viewModel = build(harness);
    await viewModel.refreshLibrary();

    expect(harness.libraryCalls()).toBe(1);
    expect(harness.listed()).toBe(0);
  });

  test('a registry failure leaves the library empty without breaking the page', async () => {
    const harness = createHarness({ libraryThrows: true });

    const viewModel = build(harness);
    await viewModel.initialize();

    expect(viewModel.hasLibrary).toBe(false);
    expect(viewModel.libraryRows).toEqual([]);
    // The hub error is the one that surfaces; the library is secondary.
    expect(viewModel.errorMessage).toBe('');
  });

  test('an import is reflected after a library refresh', async () => {
    const harness = createHarness();
    const viewModel = build(harness);
    await viewModel.initialize();
    expect(viewModel.hasLibrary).toBe(false);

    // The device now owns an asset (as it would after an import).
    harness.capabilities.listLibrary = async () => [
      { tag: 'music:community:tavern-theme', category: 'music' },
    ];
    await viewModel.refreshLibrary();

    expect(viewModel.hasLibrary).toBe(true);
    expect(viewModel.libraryRows.map((row) => row.tag)).toEqual(['music:community:tavern-theme']);
  });
});

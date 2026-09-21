// apps/frontend/client/src/lib/views/app/metadata/head_tags_view_model.test.ts
//
// Unit tests for HeadTagsViewModel — base/full metadata assembly and JSON-LD
// output. The router is an injected capability; `$app/state` is supplied by the
// shared preload.

import { describe, expect, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { page } from '$app/state';
import {
  createHeadTagsViewModel,
  type HeadTagsRouterCapabilities,
} from './head_tags_view_model.svelte';

const createRouter = (
  currentRoute: HeadTagsRouterCapabilities['currentRoute'] = undefined,
): HeadTagsRouterCapabilities => ({ currentRoute });

const createViewModel = (data?: { title: string; description?: string }) =>
  createHeadTagsViewModel({ className: 'HeadTagsViewModelTest', data, router: createRouter() });

describe('HeadTagsViewModel — metadata', () => {
  test('provides defaults when no data is supplied', () => {
    const viewModel = createViewModel();

    expect(viewModel.baseMetadata.title).toBe('AiKami');
    expect(viewModel.baseMetadata.description).toBe('Aikami');
  });

  test('merges supplied data over the defaults', () => {
    const viewModel = createViewModel({ title: 'Custom', description: 'Desc' });

    expect(viewModel.baseMetadata.title).toBe('Custom');
    expect(viewModel.baseMetadata.description).toBe('Desc');
  });

  test('setData replaces the metadata', () => {
    const viewModel = createViewModel({ title: 'First' });

    viewModel.setData({ title: 'Second' });

    expect(viewModel.baseMetadata.title).toBe('Second');
  });

  test('builds full metadata with the current page URL', () => {
    Object.assign(page, { url: new URL('https://example.com/game') });
    const viewModel = createViewModel({ title: 'Game' });

    expect(viewModel.fullMetadata.url).toBe('https://example.com/game');
    expect(viewModel.fullMetadata.openGraph?.title).toBe('Game');
    expect(viewModel.fullMetadata.robots).toBe('index,follow');
  });

  test('builds organization JSON-LD', () => {
    Object.assign(page, { url: new URL('https://example.com/') });
    const viewModel = createViewModel();

    expect(viewModel.organizationJsonLd).toContain('"@type":"Organization"');
  });
});

describe('HeadTagsViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});

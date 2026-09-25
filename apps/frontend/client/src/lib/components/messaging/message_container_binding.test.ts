// apps/frontend/client/src/lib/components/messaging/message_container_binding.test.ts
//
// Regression guard for the "End Chat" 500 on /game.
//
// A surface is mounted as `{#if viewModel.xViewModel}` (game_ui_view.svelte)
// and the host drops that reference to close the overlay. Svelte's
// `bind:this` teardown reads the binding path one last time while it detaches
// the node, so a surface that binds the transcript container into the
// ViewModel — `bind:containerElement={viewModel.messageContainerElement}` —
// dereferences `undefined` during teardown. The TypeError is unhandled, so the
// whole game route lands on the SvelteKit error page instead of closing the
// conversation.
//
// The transcript container belongs to RichMessageList itself (it owns scroll
// anchoring): no ViewModel holds a DOM node, and no view binds the container
// through a ViewModel path.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const VIEWS_DIR = resolve(import.meta.dir, '../../views');

const listFiles = (dir: string, suffix: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
};

const findIn = (suffix: string, needle: string): string[] =>
  listFiles(VIEWS_DIR, suffix)
    .filter((file) => readFileSync(file, 'utf8').includes(needle))
    .map((file) => relative(VIEWS_DIR, file))
    .sort();

describe('message container binding (End Chat 500)', () => {
  test('no view binds the transcript container through a ViewModel path', () => {
    expect(findIn('.svelte', 'bind:containerElement={viewModel.')).toEqual([]);
  });

  test('no ViewModel holds the transcript container', () => {
    expect(findIn('.svelte.ts', 'messageContainerElement')).toEqual([]);
  });
});

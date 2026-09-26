// apps/frontend/client/tests/message_container_binding.browser.test.ts

import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Host from '../src/browser_tests/fixtures/message_list_host.svelte';

// The read-only transcript mounts these collaborators but never requests audio or branches.
vi.mock('$services', () => ({
  ttsService: { activeMessageId: undefined, isPlaying: false },
  messageBranchStore: {
    enrichMessage: vi.fn(() => {
      throw new Error('read-only dialogue must not enrich chat branches');
    }),
  },
}));

const openHosts: Array<ReturnType<typeof mount>> = [];

afterEach(async () => {
  for (const host of openHosts.splice(0)) {
    await unmount(host);
  }
  document.body.innerHTML = '';
});

describe('message overlay teardown', () => {
  test.each(['button', 'Escape'] as const)(
    'closes through %s without a ViewModel binding error',
    async (method) => {
      const host = mount(Host, { target: document.body });
      openHosts.push(host);
      flushSync();
      await tick();
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain('turns to you attentively');
      expect(dialog?.querySelector('.overflow-y-auto')).not.toBeNull();

      // Drive the real overlay's ViewModel close path, which drops the host reference.
      if (method === 'button') {
        const close = [...document.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Close',
        );
        expect(close).toBeDefined();
        close?.click();
      } else {
        dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      flushSync();
      await tick();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.body.textContent).not.toContain('turns to you attentively');
    },
  );
});

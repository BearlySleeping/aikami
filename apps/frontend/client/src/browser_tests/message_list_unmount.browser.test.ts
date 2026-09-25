// apps/frontend/client/src/browser_tests/message_list_unmount.browser.test.ts
//
// Regression lane for the "End Chat" 500 (dialogue overlay teardown).
//
// Every in-game surface is mounted as `{#if viewModel.xViewModel}` and the
// host drops that reference to close the overlay. Svelte's `bind:this`
// teardown reads the binding path one last time while it detaches the node —
// so a surface that binds the transcript container into the ViewModel
// (`bind:containerElement={viewModel.messageContainerElement}`) dereferences
// `undefined` during teardown and the unhandled TypeError escalates into the
// SvelteKit error page. RichMessageList now owns its container internally, so
// nothing outside the component reads the host's ViewModel at teardown.

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import Host from './fixtures/message_list_host.svelte';

type HostInstance = ReturnType<typeof mount> & { close(): void };

const openHosts: Array<ReturnType<typeof mount>> = [];

const mountHost = (viewModel: {
  messages: { id: string; text: string; sender: 'ai'; timestamp: Date }[];
  messageContainerElement: HTMLDivElement | undefined;
}): HostInstance => {
  const component = mount(Host, { target: document.body, props: { initial: viewModel } });
  openHosts.push(component);
  flushSync();
  return component as unknown as HostInstance;
};

afterEach(() => {
  while (openHosts.length > 0) {
    const component = openHosts.pop();
    if (component) {
      void unmount(component);
    }
  }
  flushSync();
  document.body.innerHTML = '';
});

describe('RichMessageList — host drops the ViewModel while mounted', () => {
  test('unmounts without reading the dropped ViewModel', () => {
    let dropped = false;
    const host = mountHost({
      messages: [{ id: 'a', text: 'Where to, adventurer?', sender: 'ai', timestamp: new Date() }],
      get messageContainerElement(): HTMLDivElement | undefined {
        if (dropped) {
          throw new Error('teardown read the dropped ViewModel');
        }
        return undefined;
      },
    });

    expect(document.body.textContent).toContain('Where to, adventurer?');

    dropped = true;
    // A `bind:this` teardown inside this branch would throw here.
    host.close();
    flushSync();

    expect(document.body.textContent).not.toContain('Where to, adventurer?');
  });

  test('keeps owning its scroll container', () => {
    const host = mountHost({ messages: [], messageContainerElement: undefined });

    // The transcript container is the component's own DOM, never a host bind.
    const container = document.body.querySelector('div.space-y-2');
    expect(container).not.toBeNull();

    host.close();
    flushSync();
    expect(document.body.querySelector('div.space-y-2')).toBeNull();
  });
});

<script lang="ts">
// packages/frontend/components/src/lib/base/base_view_model_container.svelte
//
// Owns exactly the ViewModel instance it mounts. The container is the single
// lifecycle owner for that instance: it initializes it once per mount and
// disposes it once per mount. Parents that retain a ViewModel across tab
// switches (settings page, pause overlay) rely on this mount/unmount cycle.
import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import type { Snippet } from 'svelte';
import { untrack } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import AppLoading from '../loading/app_loading.svelte';

type Props = HTMLAttributes<HTMLElement> & {
  viewModel: BaseViewModelInterface;
  /**
   * Element id for testing
   *
   * @default className
   */
  id?: string;
  fillHeight?: boolean;
  children: Snippet;
  /**
   * The HTML element to render.
   * @default 'div'
   */
  element?: 'div' | 'footer' | 'header' | 'main' | 'section' | 'article' | 'aside' | 'nav';
};

let {
  viewModel,
  id,
  fillHeight = false,
  children,
  class: classStyle,
  element = 'div',
  ...attributes
}: Props = $props();

/**
 * Reports a lifecycle failure. Initialization/disposal are fire-and-forget, so
 * without this a rejection would surface as an unhandled promise rejection with
 * no indication of which ViewModel failed.
 */
const reportLifecycleError = (
  phase: 'initialize' | 'dispose',
  instance: BaseViewModelInterface,
  error: unknown,
): void => {
  // biome-ignore lint/suspicious/noConsole: this component layer has no logger dependency
  console.error(`[BaseViewModelContainer] ${phase}() failed for ${instance._className}`, error);
};

/**
 * Tracks the `viewModel` prop. When it changes, this effect's cleanup runs
 * against the previous instance (disposing it) before the new instance is
 * initialized, so a replaced ViewModel is never orphaned.
 *
 * Disposal is deferred rather than skipped when the component unmounts while
 * `initialize()` is still in flight: `initialize()` can create effects and
 * resources after teardown, so waiting for it to settle and disposing once
 * afterwards is what prevents a leak. Exactly one dispose per owned instance
 * per mount — do not dispose the same ViewModel anywhere else.
 */
$effect(() => {
  const instance = viewModel;
  // Only the `viewModel` prop is a dependency. `initialize()` may read and
  // write reactive VM state; tracking that here would re-run (and thus
  // dispose) the instance on its own initialization.
  return untrack(() => {
    // A shared instance already mounted elsewhere (e.g. a section retained by
    // its parent) is left alone: one owner at a time.
    if (instance.__mounted) {
      return;
    }
    instance.__mounted = true;

    let mounted = true;
    let settled = false;
    let disposed = false;

    const disposeOnce = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      instance.__mounted = false;
      void instance.dispose().catch((error: unknown) => {
        reportLifecycleError('dispose', instance, error);
      });
    };

    void instance
      .initialize()
      .catch((error: unknown) => {
        reportLifecycleError('initialize', instance, error);
      })
      .finally(() => {
        settled = true;
        if (!mounted) {
          disposeOnce();
        }
      });

    return () => {
      mounted = false;
      if (settled) {
        disposeOnce();
      }
    };
  });
});
</script>

<svelte:element
  this={element}
  {...attributes}
  data-testid={id || viewModel._className}
  class:h-screen={fillHeight}
  class={classStyle}
>
  {#if viewModel.showLoadingView}
    <AppLoading />
  {:else}
    {@render children()}
  {/if}
</svelte:element>

// apps/frontend/client/src/browser_tests/fixtures/container_lifecycle_fixtures.svelte.ts
//
// Compiled-component fixtures for the BaseViewModelContainer lifecycle tests.
// Built on the real BaseViewModel so the tests exercise the production
// initialize/dispose/registerEffectRoot chain under the real Svelte runtime.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { createDeferred } from '@aikami/utils';
import type { AiSettingsViewModelInterface } from '../../lib/views/settings/ai/ai_settings_view_model.svelte';
import { createCapabilityDetailViewModel } from '../../lib/views/settings/ai/capability_detail_view_model.svelte';

export type LifecycleFixtureOptions = BaseViewModelOptions & {
  /** initialize() waits for resolveInitialize() before registering resources. */
  pendingInitialize?: boolean;
  /** initialize() rejects with this error after any resource registration. */
  initializeError?: Error;
  /** dispose() rejects with this error after the base cleanup. */
  disposeError?: Error;
  /**
   * initialize() registers a `$effect.root` AFTER any deferred wait, so a
   * component that unmounts mid-initialize can prove the container still tears
   * the late-created effect down.
   */
  registerEffectOnInitialize?: boolean;
};

export type LifecycleFixtureInterface = BaseViewModelInterface & {
  readonly initializeCount: number;
  readonly disposeCount: number;
  readonly effectCleanupCount: number;
  resolveInitialize(): void;
  rejectInitialize(error: Error): void;
};

class LifecycleFixture
  extends BaseViewModel<LifecycleFixtureOptions>
  implements LifecycleFixtureInterface
{
  initializeCount = $state(0);
  disposeCount = $state(0);
  effectCleanupCount = $state(0);

  private readonly _pending = createDeferred<void, Error>();

  override async initialize(): Promise<void> {
    this.initializeCount += 1;
    if (this._options.pendingInitialize) {
      await this._pending.promise;
    }
    if (this._options.registerEffectOnInitialize) {
      this.registerEffectRoot(() => {
        $effect(() => () => {
          this.effectCleanupCount += 1;
        });
      });
    }
    if (this._options.initializeError) {
      throw this._options.initializeError;
    }
    await super.initialize();
  }

  override async dispose(): Promise<void> {
    this.disposeCount += 1;
    await super.dispose();
    if (this._options.disposeError) {
      throw this._options.disposeError;
    }
  }

  resolveInitialize(): void {
    this._pending.resolve();
  }

  rejectInitialize(error: Error): void {
    this._pending.reject(error);
  }
}

export const createLifecycleFixture = (
  options: Omit<LifecycleFixtureOptions, 'className'>,
): LifecycleFixtureInterface =>
  LifecycleFixture.create({ className: 'LifecycleFixture', ...options });

/**
 * Minimal AI-editor double for the owner-lifetime test. Only the surface
 * CapabilityDetailViewModel touches is implemented; the cast is the typed
 * boundary between a deliberate test double and the full editor contract.
 */
class EditorDouble extends BaseViewModel<BaseViewModelOptions> {
  editorInitializeCount = $state(0);
  editorDisposeCount = $state(0);

  override async initialize(): Promise<void> {
    this.editorInitializeCount += 1;
    await super.initialize();
  }

  override async dispose(): Promise<void> {
    this.editorDisposeCount += 1;
    await super.dispose();
  }
}

export type EditorDoubleInterface = BaseViewModelInterface & {
  readonly editorInitializeCount: number;
  readonly editorDisposeCount: number;
};

export const createEditorDouble = (): EditorDoubleInterface =>
  // guard-ignore lint/type-safety/casting: test double stands in for the full editor contract at the DI boundary
  EditorDouble.create({ className: 'EditorDouble' }) as unknown as EditorDoubleInterface;

/** Builds a real CapabilityDetailViewModel whose owned editor is the double above. */
export const createDetailWithEditor = (editor: EditorDoubleInterface) =>
  createCapabilityDetailViewModel({
    className: 'CapabilityDetailViewModel',
    capability: 'text',
    getStatusEntries: () => [],
    // guard-ignore lint/type-safety/casting: the double implements only what this owner calls
    createAiSettings: () => editor as unknown as AiSettingsViewModelInterface,
  });

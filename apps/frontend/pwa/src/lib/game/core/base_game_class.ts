// apps/frontend/pwa/src/lib/game/core/base_game_class.ts
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';

export type BaseGameClassOptions = BaseClassOptions;

export type BaseGameClassInterface = BaseClassInterface & {
  /**
   * Sets up any async initialization the class needs after construction.
   * Called after the constructor, before the class is ready for use.
   */
  setup(): Promise<void>;
};

/**
 * Base class for all game engine classes.
 *
 * Extends {@link BaseClass} from `@aikami/utils` with a no-op `setup()`
 * method that subclasses can override for async initialization. The game
 * engine has ZERO Svelte dependencies — this is pure imperative TypeScript
 * for the PixiJS v8 + bitECS runtime.
 */
export abstract class BaseGameClass<Options extends BaseGameClassOptions = BaseGameClassOptions>
  extends BaseClass<Options>
  implements BaseGameClassInterface
{
  /**
   * Async setup hook. Override in subclasses that need async initialization
   * after construction. Called once, before the class enters its ready state.
   */
  async setup(): Promise<void> {}
}

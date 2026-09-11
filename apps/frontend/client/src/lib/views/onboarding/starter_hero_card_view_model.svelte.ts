// apps/frontend/client/src/lib/views/onboarding/starter_hero_card_view_model.svelte.ts
//
// Owns the starter hero card's LPC portrait lifecycle so the Svelte view only
// binds rendered state and forwards user events.

import type { StarterHero } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { buildStarterHeroRecipes } from '$lib/data/starter_hero_recipes';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$lib/views/character/lpc_preview/lpc_preview_view_model.svelte';

/** View-facing state and events for one starter hero card. */
export type StarterHeroCardViewModelInterface = BaseViewModelInterface & {
  readonly name: string;
  readonly race: string;
  readonly characterClass: string;
  readonly flavorText: string;
  readonly alignment: string;
  readonly ariaLabel: string;
  canvasElement: HTMLCanvasElement | undefined;
  select(): void;
};

/** Dependencies needed to render and select one starter hero. */
export type StarterHeroCardViewModelOptions = BaseViewModelOptions & {
  hero: StarterHero;
  onclick(): void;
};

class StarterHeroCardViewModel
  extends BaseViewModel<StarterHeroCardViewModelOptions>
  implements StarterHeroCardViewModelInterface
{
  private readonly _hero: StarterHero;
  private readonly _onclick: () => void;
  private readonly _previewViewModel: LpcPreviewViewModelInterface;
  private _isInitializationActive = false;
  private _previewInitializationStarted = false;

  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);

  constructor(options: StarterHeroCardViewModelOptions) {
    super(options);
    this._hero = options.hero;
    this._onclick = options.onclick;
    this._previewViewModel = getLpcPreviewViewModel({
      className: 'StarterHeroPortraitPreview',
      width: 128,
      height: 128,
    });
  }

  get name(): string {
    return this._hero.name;
  }

  get race(): string {
    return this._hero.race;
  }

  get characterClass(): string {
    return this._hero.class;
  }

  get flavorText(): string {
    return this._hero.flavorText;
  }

  get alignment(): string {
    return this._hero.alignment;
  }

  get ariaLabel(): string {
    return `Select ${this.name}, ${this.race} ${this.characterClass}`;
  }

  override async initialize(): Promise<void> {
    if (this._isInitializationActive) {
      return;
    }
    this._isInitializationActive = true;
    this._previewInitializationStarted = false;
    this._previewViewModel.setRecipes(buildStarterHeroRecipes(this._hero));

    this.registerEffectRoot(() => {
      $effect(() => {
        const canvas = this.canvasElement;
        if (!canvas || !this._isInitializationActive || this._previewInitializationStarted) {
          return;
        }
        this._previewInitializationStarted = true;
        this._previewViewModel.setCanvasElement(canvas);
        void this._previewViewModel.initialize();
      });
    });

    await super.initialize();
  }

  select(): void {
    this._onclick();
  }

  override async dispose(): Promise<void> {
    this._isInitializationActive = false;
    this.canvasElement = undefined;
    await this._previewViewModel.dispose();
    await super.dispose();
  }
}

/** Creates a lifecycle-safe starter hero card ViewModel. */
export const getStarterHeroCardViewModel = (
  options: StarterHeroCardViewModelOptions,
): StarterHeroCardViewModelInterface => StarterHeroCardViewModel.create(options);

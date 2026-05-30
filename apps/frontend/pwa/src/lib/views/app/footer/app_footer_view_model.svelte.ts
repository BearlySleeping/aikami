// apps/frontend/pwa/src/lib/views/app/footer/app-footer-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

export type AppFooterViewModelOptions = BaseViewModelOptions;

export type AppFooterViewModelInterface = BaseViewModelInterface & {
  /**
   * Navigates to the help page.
   */
  goToHelp(): void;

  /**
   * Navigates to the bug report page.
   */
  goToBugReport(): void;

  /**
   * Opens a social media link.
   * @param platform The social media platform to open.
   */
  openSocialLink(platform: 'twitter' | 'discord' | 'github'): void;
};

class AppFooterViewModel
  extends BaseViewModel<AppFooterViewModelOptions>
  implements AppFooterViewModelInterface
{
  goToHelp(): void {
    globalThis.open('https://github.com/airgp/airgp/issues/new', '_blank', 'noopener,noreferrer');
  }

  goToBugReport(): void {
    // TODO: Create bug report page or external link
    // link to github page
    globalThis.open('https://github.com/airgp/airgp/issues/new', '_blank', 'noopener,noreferrer');
  }

  openSocialLink(platform: 'twitter' | 'discord' | 'github'): void {
    const urls = {
      twitter: 'https://twitter.com/airgp', // TODO: Update with actual social links
      discord: 'https://discord.gg/airgp',
      github: 'https://github.com/airgp/airgp',
    };

    const url = urls[platform];
    if (url) {
      globalThis.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}

export const getAppFooterViewModel = (
  options: AppFooterViewModelOptions,
): AppFooterViewModelInterface => new AppFooterViewModel(options);

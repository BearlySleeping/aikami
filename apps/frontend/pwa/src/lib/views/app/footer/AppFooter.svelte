<script lang="ts">
import { getAppFooterViewModel } from './app-footer-view-model.svelte.ts';

const _viewModel = getAppFooterViewModel({
  className: 'AppFooter',
});
</script>

<BaseViewModelContainer
    {viewModel}
    element="footer"
    class="footer footer-center p-10 bg-base-100 text-base-content border-t border-base-300"
>
    <aside class="space-y-4">
        <div class="flex items-center space-x-2">
            <div
                class="w-8 h-8 bg-primary rounded-full flex items-center justify-center"
            >
                <span class="text-primary-content font-bold">AI</span>
            </div>
            <div class="text-xl font-bold">{t.app_name()}</div>
        </div>
        <p class="text-base-content/70 max-w-md">
            Experience the future of role-playing games with AI-powered
            characters and immersive storytelling.
        </p>
        <p class="text-sm text-base-content/60">
            © 2024 {t.app_name()}. All rights reserved.
        </p>
    </aside>

    <nav class="grid grid-flow-col gap-4">
        <div class="flex flex-col space-y-2">
            <h4 class="footer-title">Support</h4>
            <button
                class="link link-hover text-left"
                onclick={() => viewModel.goToHelp()}
            >
                Help Center
            </button>
            <button
                class="link link-hover text-left"
                onclick={() => viewModel.goToBugReport()}
            >
                Report Bug
            </button>
        </div>
    </nav>

    <nav class="flex space-x-4">
        <div class="tooltip" data-tip="Follow us on Twitter">
            <button
                class="btn btn-ghost btn-circle"
                onclick={() => viewModel.openSocialLink("twitter")}
                aria-label="Follow us on Twitter"
            >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path
                        d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84"
                    />
                </svg>
            </button>
        </div>

        <div class="tooltip" data-tip="Join our Discord">
            <button
                class="btn btn-ghost btn-circle"
                onclick={() => viewModel.openSocialLink("discord")}
                aria-label="Join our Discord"
            >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path
                        d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
                    />
                </svg>
            </button>
        </div>

        <div class="tooltip" data-tip="Star us on GitHub">
            <button
                class="btn btn-ghost btn-circle"
                onclick={() => viewModel.openSocialLink("github")}
                aria-label="Star us on GitHub"
            >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path
                        d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                    />
                </svg>
            </button>
        </div>
    </nav>
</BaseViewModelContainer>

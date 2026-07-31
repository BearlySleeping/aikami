<script lang="ts">
// apps/frontend/client/src/lib/views/app/app_view.svelte

import type { Snippet } from 'svelte';
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { AppViewModelInterface } from './app_view_model.svelte.ts';
import AppDialogsView from './dialogs/app_dialogs_view.svelte';
import HeadTagsViewModel from './metadata/head_tags_view.svelte';

type Props = {
  viewModel: AppViewModelInterface;
  children: Snippet;
};

let { viewModel, children }: Props = $props();
</script>

<HeadTagsViewModel />

<BaseViewModelContainer {viewModel}> {@render children()} </BaseViewModelContainer>

<AppDialogsView />

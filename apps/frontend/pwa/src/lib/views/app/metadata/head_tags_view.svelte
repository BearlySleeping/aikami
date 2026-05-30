<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/metadata/HeadTagsView.svelte
  import {
    type BaseMetaTags,
    getHeadTagsViewModel,
    type HeadTagsViewModelInterface,
  } from './head_tags_view_model.svelte.ts';

  interface Props {
    data?: BaseMetaTags;
    viewModel?: HeadTagsViewModelInterface;
  }

  let {
    data,
    // svelte-ignore state_referenced_locally
    viewModel = getHeadTagsViewModel({ data, className: 'HeadTagsView' }),
  }: Props = $props();
</script>

<svelte:head>
  <meta name="robots" content={viewModel.fullMetadata.robots}>
  <meta name="googlebot" content={viewModel.fullMetadata.robots}>

  {#if viewModel.fullMetadata.title}
    <title>{viewModel.fullMetadata.title}</title>
    <meta name="title" content={viewModel.fullMetadata.title}>
  {/if}

  {#if viewModel.fullMetadata.description}
    <meta name="description" content={viewModel.fullMetadata.description}>
  {/if}

  {#if viewModel.fullMetadata.author}
    <meta name="author" content={viewModel.fullMetadata.author}>
  {/if}

  {#if viewModel.fullMetadata.keywords}
    <meta name="keywords" content={viewModel.fullMetadata.keywords.join(", ")}>
  {/if}

  {#if viewModel.fullMetadata.url}
    <link rel="canonical" href={viewModel.fullMetadata.url}>
  {/if}

  {#if viewModel.fullMetadata.twitter}
    <meta name="twitter:card" content="summary_large_image">

    {#each Object.entries(viewModel.fullMetadata.twitter) as [ tag, content ] (tag)}
      <meta name={tag} property="twitter:{tag}" content={String(content)}>
    {/each}
  {/if}

  {#if viewModel.fullMetadata.openGraph}
    {#each Object.entries(viewModel.fullMetadata.openGraph) as [ tag, content ] (tag)}
      <meta name={tag} property="og:{tag}" content={String(content)}>
    {/each}
  {/if}

  {#if viewModel.fullMetadata.article}
    {#each Object.entries(viewModel.fullMetadata.article) as [ tag, content ] (tag)}
      <meta name={tag} property="article:{tag}" content={String(content)}>
    {/each}
  {/if}

  {#if viewModel.organizationJsonLd}
    {@html viewModel.organizationJsonLd}
  {/if}

  {#if viewModel.searchActionJsonLd}
    {@html viewModel.searchActionJsonLd}
  {/if}
</svelte:head>

<script lang="ts">
import {
  type BaseMetaTags,
  getHeadTagsViewModel,
  type HeadTagsViewModelInterface,
} from './head-tags-view-model.svelte.ts';

interface Props {
  data: BaseMetaTags;
  baseURL: string;
  path: string;
  viewModel?: HeadTagsViewModelInterface;
}

let {
  data,
  baseURL,
  path,
  viewModel = getHeadTagsViewModel({ className: 'HeadTagsView' }),
}: Props = $props();

$effect(() => {
  viewModel.setData(data);
  viewModel.setBaseURL(baseURL);
  viewModel.setPath(path);
});

const metadata = $derived(viewModel.fullMetadata());
const organizationJsonLd = $derived(viewModel.organizationJsonLd());
const searchActionJsonLd = $derived(viewModel.searchActionJsonLd());
</script>

<svelte:head>
    <meta name="robots" content={metadata.robots} />
    <meta name="googlebot" content={metadata.robots} />

    {#if metadata.title}
        <title>{metadata.title}</title>
        <meta name="title" content={metadata.title} />
    {/if}

    {#if metadata.description}
        <meta name="description" content={metadata.description} />
    {/if}

    {#if metadata.author}
        <meta name="author" content={metadata.author} />
    {/if}

    {#if metadata.keywords}
        <meta name="keywords" content={metadata.keywords.join(", ")} />
    {/if}

    {#if metadata.url}
        <link rel="canonical" href={metadata.url} />
    {/if}

    {#if metadata.twitter}
        <meta name="twitter:card" content="summary_large_image" />

        {#each Object.entries(metadata.twitter) as [tag, content] (tag)}
            <meta
                name={tag}
                property="twitter:{tag}"
                content={String(content)}
            />
        {/each}
    {/if}

    {#if metadata.openGraph}
        {#each Object.entries(metadata.openGraph) as [tag, content] (tag)}
            <meta name={tag} property="og:{tag}" content={String(content)} />
        {/each}
    {/if}

    {#if metadata.article}
        {#each Object.entries(metadata.article) as [tag, content] (tag)}
            <meta
                name={tag}
                property="article:{tag}"
                content={String(content)}
            />
        {/each}
    {/if}

    {#if organizationJsonLd}
        {@html organizationJsonLd}
    {/if}

    {#if searchActionJsonLd}
        {@html searchActionJsonLd}
    {/if}
</svelte:head>

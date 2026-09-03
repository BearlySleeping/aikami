<script lang="ts" generics="GroupId extends string, SectionId extends string">
// packages/frontend/components/src/lib/grouped_tablist/grouped_tablist.svelte

import type { Snippet } from 'svelte';

type TabItem<Id extends string> = {
  id: Id;
  label: string;
  icon?: string;
};

type Props = {
  id: string;
  groupLabel: string;
  groupTabs: readonly TabItem<GroupId>[];
  activeGroupId: GroupId;
  sectionLabel: string;
  sectionTabs: readonly TabItem<SectionId>[];
  activeSectionId: SectionId;
  onGroupActivate: (id: GroupId) => void;
  onSectionActivate: (id: SectionId) => void;
  children: Snippet;
};

const {
  id,
  groupLabel,
  groupTabs,
  activeGroupId,
  sectionLabel,
  sectionTabs,
  activeSectionId,
  onGroupActivate,
  onSectionActivate,
  children,
}: Props = $props();

const iconPaths: Readonly<Record<string, string>> = {
  keyboard:
    'M4 7v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2zm2 2h12v6H6V9zm2 2h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zm-8 4h8v2H8v-2z',
  speaker:
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  monitor:
    'M4 3h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2zm0 2v8h16V5H4zm4 12h8v2H8v-2z',
  cog: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  shield:
    'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  users:
    'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  refresh:
    'M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
};

const getIconPath = (icon: string): string => iconPaths[icon] ?? iconPaths.cog;

/** Applies ARIA tab keyboard navigation and moves DOM focus to the activated tab. */
const handleTablistKeydown = <Id extends string>(options: {
  event: KeyboardEvent;
  idPrefix: string;
  tabs: readonly TabItem<Id>[];
  activeId: Id;
  activate: (id: Id) => void;
}): void => {
  const currentIndex = options.tabs.findIndex((tab) => tab.id === options.activeId);
  if (currentIndex < 0) {
    return;
  }

  let nextIndex: number | undefined;
  switch (options.event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      nextIndex = (currentIndex + 1) % options.tabs.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      nextIndex = (currentIndex - 1 + options.tabs.length) % options.tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = options.tabs.length - 1;
      break;
    default:
      return;
  }

  const nextTab = options.tabs[nextIndex];
  if (!nextTab) {
    return;
  }

  options.event.preventDefault();
  options.activate(nextTab.id);
  document.getElementById(`${options.idPrefix}${nextTab.id}`)?.focus();
};
</script>

<div
  class="tabs tabs-boxed bg-base-100 mx-6 mt-6 justify-center flex-wrap"
  role="tablist"
  aria-label={groupLabel}
>
  {#each groupTabs as tab (tab.id)}
    <button
      type="button"
      id="{id}-group-tab-{tab.id}"
      class="tab tab-lg"
      role="tab"
      aria-selected={activeGroupId === tab.id}
      aria-controls="{id}-group-panel"
      tabindex={activeGroupId === tab.id ? 0 : -1}
      class:tab-active={activeGroupId === tab.id}
      onclick={() => onGroupActivate(tab.id)}
      onkeydown={(event) =>
        handleTablistKeydown({
          event,
          idPrefix: `${id}-group-tab-`,
          tabs: groupTabs,
          activeId: activeGroupId,
          activate: onGroupActivate,
        })}
    >
      {tab.label}
    </button>
  {/each}
</div>

<div id="{id}-group-panel" role="tabpanel" aria-labelledby="{id}-group-tab-{activeGroupId}">
  <div
    class="tabs tabs-bordered mx-6 mb-6 justify-center flex-wrap"
    role="tablist"
    aria-label={sectionLabel}
  >
    {#each sectionTabs as tab (tab.id)}
      <button
        type="button"
        id="{id}-section-tab-{tab.id}"
        class="tab gap-2"
        role="tab"
        aria-selected={activeSectionId === tab.id}
        aria-controls="{id}-section-panel"
        tabindex={activeSectionId === tab.id ? 0 : -1}
        class:tab-active={activeSectionId === tab.id}
        onclick={() => onSectionActivate(tab.id)}
        onkeydown={(event) =>
          handleTablistKeydown({
            event,
            idPrefix: `${id}-section-tab-`,
            tabs: sectionTabs,
            activeId: activeSectionId,
            activate: onSectionActivate,
          })}
      >
        {#if tab.icon}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d={getIconPath(tab.icon)} />
          </svg>
        {/if}
        {tab.label}
      </button>
    {/each}
  </div>

  <div
    id="{id}-section-panel"
    class="px-6 pb-6 max-w-2xl"
    role="tabpanel"
    aria-labelledby="{id}-section-tab-{activeSectionId}"
  >
    {@render children()}
  </div>
</div>

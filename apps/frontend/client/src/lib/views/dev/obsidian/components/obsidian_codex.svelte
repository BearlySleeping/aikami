<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_codex.svelte
//
// One management workspace for Character, Inventory, Journal, Party, and
// World. Character and Party share the same actor inspector; Inventory keeps
// bag, equipment, and comparison side by side.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<section
  class="flex min-h-0 w-full flex-1 flex-col bg-panel"
  aria-label="Codex"
  data-testid="obsidian-codex"
>
  <header class="flex shrink-0 items-center gap-2 border-b border-brass/20 px-3 py-2">
    <h2 class="font-display text-base text-base-content">Codex</h2>
    <span class="text-xs text-base-content/50">Character, inventory, journal, party, world</span>
    <button
      type="button"
      class="btn btn-ghost btn-xs ml-auto"
      onclick={() => viewModel.closeCodex()}
    >
      Return to play
    </button>
  </header>

  <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-brass/10 px-3 py-1.5">
    {#each viewModel.navItems as item (item.id)}
      <button
        type="button"
        class="rounded-md px-3 py-1 text-sm"
        class:bg-primary={viewModel.codexSection === item.id}
        class:text-primary-content={viewModel.codexSection === item.id}
        class:nav-muted={viewModel.codexSection !== item.id}
        aria-pressed={viewModel.codexSection === item.id}
        title="Shortcut {item.shortcut}"
        onclick={() => viewModel.setCodexSection(item.id)}
      >
        {item.label}
      </button>
    {/each}
  </nav>

  <div class="min-h-0 flex-1 overflow-y-auto p-3" data-testid="codex-content">
    {#if viewModel.codexSection === 'character' || viewModel.codexSection === 'party'}
      {#if viewModel.inspectedActor}
        {#if viewModel.codexSection === 'party'}
          <div class="mb-3 flex flex-wrap gap-2">
            {#each viewModel.actors as actor (actor.id)}
              <button
                type="button"
                class="rounded-lg border px-2 py-1 text-sm"
                class:border-primary={viewModel.inspectedActorId === actor.id}
                class:bg-ink={viewModel.inspectedActorId === actor.id}
                class:border-base-300={viewModel.inspectedActorId !== actor.id}
                onclick={() => viewModel.selectActor(actor.id)}
              >
                {actor.name}
                <span class="ml-1 text-[10px] uppercase tracking-wide text-base-content/45">
                  {actor.kind}
                </span>
              </button>
            {/each}
          </div>
        {/if}
        <div class="grid gap-3 lg:grid-cols-[1fr_18rem]">
          <div class="flex flex-col gap-3">
            <div class="rounded-xl border border-brass/20 bg-elevated p-3">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-12 w-12 items-center justify-center rounded-full border border-brass/40 font-display text-lg text-base-content"
                  style="background: oklch(0.34 0.06 {viewModel.inspectedActor.hue})"
                  aria-hidden="true"
                >
                  {viewModel.inspectedActor.name.slice(0, 1)}
                </span>
                <div>
                  <h3 class="font-display text-lg text-base-content">
                    {viewModel.inspectedActor.name}
                  </h3>
                  <p class="text-xs text-base-content/55">{viewModel.inspectedActor.role}</p>
                </div>
                <div class="ml-auto text-right text-xs text-base-content/60">
                  <p>HP {viewModel.inspectedActor.hp}/{viewModel.inspectedActor.maxHp}</p>
                  <p>AC {viewModel.inspectedActor.ac}</p>
                </div>
              </div>
              <p class="mt-2 text-sm leading-relaxed text-base-content/75">
                {viewModel.inspectedActor.summary}
              </p>
              {#if viewModel.inspectedActor.relationship}
                <p class="mt-2 rounded-lg border border-brass/20 bg-ink px-2 py-1.5 text-xs">
                  <span class="text-brass">{viewModel.inspectedActor.relationship.standing}</span>
                  · {viewModel.inspectedActor.relationship.recent}
                </p>
              {/if}
            </div>

            <div class="rounded-xl border border-brass/20 bg-elevated p-3">
              <h4 class="font-display text-xs uppercase tracking-widest text-brass">Abilities</h4>
              <dl class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {#each viewModel.inspectedActor.abilities as ability (ability.label)}
                  <div class="rounded-lg border border-base-300 bg-ink p-2 text-center">
                    <dt class="text-[10px] uppercase tracking-wide text-base-content/50">
                      {ability.label}
                    </dt>
                    <dd class="font-mono text-lg tabular-nums text-base-content">
                      {ability.value}
                    </dd>
                  </div>
                {/each}
              </dl>
            </div>

            <div class="rounded-xl border border-brass/20 bg-elevated p-3">
              <h4 class="font-display text-xs uppercase tracking-widest text-brass">Skills</h4>
              <ul class="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {#each viewModel.inspectedActor.skills as skill (skill.label)}
                  <li class="flex items-center justify-between text-sm">
                    <span class="text-base-content/75">
                      {skill.label}
                      {#if skill.proficient}
                        <span class="text-[10px] uppercase text-brass">prof</span>
                      {/if}
                    </span>
                    <span class="font-mono tabular-nums text-base-content">
                      {viewModel.signedValue(skill.bonus)}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>

            {#if viewModel.inspectedActor.spells.length > 0}
              <div class="rounded-xl border border-brass/20 bg-elevated p-3">
                <h4 class="font-display text-xs uppercase tracking-widest text-brass">
                  Spells & actions
                </h4>
                <ul class="mt-2 flex flex-col gap-2">
                  {#each viewModel.inspectedActor.spells as spell (spell.id)}
                    <li class="rounded-lg border border-base-300 bg-ink p-2">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-semibold text-base-content">{spell.name}</span>
                        <span class="badge badge-sm">{spell.cost}</span>
                        <span class="text-xs text-base-content/50">{spell.range}</span>
                        {#if spell.concentration}
                          <span class="text-[10px] uppercase text-warning">concentration</span>
                        {/if}
                      </div>
                      <p class="mt-1 text-xs text-base-content/70">{spell.description}</p>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>

          <div class="flex flex-col gap-3">
            <div class="rounded-xl border border-brass/20 bg-elevated p-3">
              <h4 class="font-display text-xs uppercase tracking-widest text-brass">Features</h4>
              <ul class="mt-2 flex flex-col gap-2">
                {#each viewModel.inspectedActor.features as feature (feature.name)}
                  <li>
                    <p class="text-sm font-semibold text-base-content">{feature.name}</p>
                    <p class="text-xs text-base-content/70">{feature.description}</p>
                  </li>
                {/each}
              </ul>
            </div>
            <div class="rounded-xl border border-brass/20 bg-elevated p-3">
              <h4 class="font-display text-xs uppercase tracking-widest text-brass">Equipped</h4>
              <p class="mt-1 text-xs text-base-content/70">{viewModel.equipmentSummary}</p>
            </div>
          </div>
        </div>
      {/if}
    {:else if viewModel.codexSection === 'inventory'}
      <div class="grid gap-3 lg:grid-cols-[16rem_1fr]">
        <div class="flex flex-col gap-3">
          <div class="rounded-xl border border-brass/20 bg-elevated p-3">
            <h4 class="font-display text-xs uppercase tracking-widest text-brass">Equipped</h4>
            <ul class="mt-2 flex flex-col gap-1 text-sm">
              {#each viewModel.equippedRows as row (row.slot)}
                <li class="flex items-center justify-between gap-2">
                  <span class="text-base-content/55">{row.slotLabel}</span>
                  <span class="truncate text-base-content">{row.itemName}</span>
                </li>
              {/each}
            </ul>
          </div>
          <div class="rounded-xl border border-brass/20 bg-elevated p-3">
            <h4 class="font-display text-xs uppercase tracking-widest text-brass">Bag</h4>
            <ul class="mt-2 flex flex-col gap-1">
              {#each viewModel.items as item (item.id)}
                <li>
                  <button
                    type="button"
                    class="w-full rounded-lg border px-2 py-1.5 text-left text-sm"
                    class:border-primary={viewModel.selectedItemId === item.id}
                    class:bg-ink={viewModel.selectedItemId === item.id}
                    class:border-transparent={viewModel.selectedItemId !== item.id}
                    onclick={() => viewModel.selectItem(item.id)}
                  >
                    <span class="flex items-center gap-1">
                      <span class="truncate text-base-content">{item.name}</span>
                      {#if item.favorite}
                        <span class="text-brass" title="Favorite">★</span>
                      {/if}
                      {#if item.quantity > 1}
                        <span class="ml-auto font-mono text-xs text-base-content/60"
                          >×{item.quantity}</span
                        >
                      {/if}
                    </span>
                    <span class="block truncate text-xs text-base-content/50">{item.type}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        </div>

        {#if viewModel.selectedItem}
          <div class="rounded-xl border border-brass/20 bg-elevated p-3">
            <div class="flex items-start gap-2">
              <div>
                <h3 class="font-display text-lg text-base-content">
                  {viewModel.selectedItem.name}
                </h3>
                <p class="text-xs text-base-content/55">{viewModel.selectedItem.type}</p>
              </div>
              <div class="ml-auto flex gap-1">
                {#if viewModel.selectedItem.equippedSlot}
                  {#if viewModel.isSelectedEquipped}
                    <button
                      type="button"
                      class="btn btn-outline btn-xs"
                      onclick={() => viewModel.unequipSelected()}
                    >
                      Unequip
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="btn btn-primary btn-xs"
                      onclick={() => viewModel.equipSelected()}
                    >
                      Equip
                    </button>
                  {/if}
                {/if}
              </div>
            </div>

            <p class="mt-2 text-sm leading-relaxed text-base-content/75">
              {viewModel.selectedItem.description}
            </p>

            <dl class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <dt class="text-base-content/50">Quantity</dt>
                <dd class="font-mono text-base-content">{viewModel.selectedItem.quantity}</dd>
              </div>
              <div>
                <dt class="text-base-content/50">Weight</dt>
                <dd class="font-mono text-base-content">{viewModel.selectedItem.weight}</dd>
              </div>
              <div>
                <dt class="text-base-content/50">Value</dt>
                <dd class="text-base-content">{viewModel.selectedItem.value}</dd>
              </div>
              <div>
                <dt class="text-base-content/50">Attunement</dt>
                <dd class="text-base-content">
                  {viewModel.selectedItem.attunement ? 'Required' : 'No'}
                </dd>
              </div>
            </dl>

            {#if viewModel.selectedItem.properties.length > 0}
              <ul class="mt-2 flex flex-wrap gap-1">
                {#each viewModel.selectedItem.properties as property (property)}
                  <li class="rounded bg-ink px-2 py-0.5 text-xs text-base-content/70">
                    {property}
                  </li>
                {/each}
              </ul>
            {/if}

            {#if viewModel.comparisonRows.length > 0}
              <h4 class="mt-3 font-display text-xs uppercase tracking-widest text-brass">
                Versus equipped
              </h4>
              <ul class="mt-1 flex flex-col gap-1 text-sm">
                {#each viewModel.comparisonRows as row (row.label)}
                  <li class="flex items-center gap-2">
                    <span class="w-24 text-base-content/60">{row.label}</span>
                    <span class="font-mono text-base-content/50">{row.currentLabel}</span>
                    <span class="text-base-content/40">→</span>
                    <span class="font-mono text-base-content">{row.incomingLabel}</span>
                    <span
                      class="ml-auto font-mono"
                      class:text-success={row.isGain}
                      class:text-error={!row.isGain}
                    >
                      {viewModel.signedValue(row.delta)}
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>
    {:else if viewModel.codexSection === 'journal'}
      <div class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-xl border border-brass/20 bg-elevated p-3">
          <h4 class="font-display text-xs uppercase tracking-widest text-brass">Quests</h4>
          <ul class="mt-2 flex flex-col gap-3">
            {#each viewModel.quests as quest (quest.id)}
              <li>
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-base-content">{quest.title}</span>
                  <span class="badge badge-sm">{quest.status}</span>
                </div>
                <p class="text-xs text-base-content/60">{quest.objective}</p>
                <ul class="mt-1 flex flex-col gap-0.5">
                  {#each quest.steps as step (step.id)}
                    <li class="flex items-center gap-2 text-xs">
                      <span class:text-success={step.done} class:step-faint={!step.done}>
                        {step.done ? '✓' : '○'}
                      </span>
                      <span class:step-label-done={step.done} class:step-faint={!step.done}>
                        {step.label}
                      </span>
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        </div>

        <div class="flex flex-col gap-3">
          <div class="rounded-xl border border-brass/20 bg-elevated p-3">
            <h4 class="font-display text-xs uppercase tracking-widest text-brass">Your notes</h4>
            <ul class="mt-2 flex flex-col gap-2">
              {#each viewModel.notes as note (note.id)}
                <li>
                  <p class="text-sm font-semibold text-base-content">{note.title}</p>
                  <p class="text-xs text-base-content/70">{note.body}</p>
                  <p class="text-[10px] text-base-content/40">{note.updatedLabel}</p>
                </li>
              {/each}
            </ul>
          </div>

          <div class="rounded-xl border border-brass/20 bg-elevated p-3">
            <h4 class="font-display text-xs uppercase tracking-widest text-brass">AI summaries</h4>
            <ul class="mt-2 flex flex-col gap-2">
              {#each viewModel.summaries as summary (summary.id)}
                <li class="rounded-lg border border-base-300 bg-ink p-2">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-base-content">{summary.title}</span>
                    {#if summary.stale}
                      <span class="badge badge-sm border-warning/40 text-warning">stale</span>
                    {/if}
                    <button
                      type="button"
                      class="ml-auto text-xs text-primary underline-offset-2 hover:underline"
                      onclick={() => viewModel.regenerateSummary(summary.id)}
                    >
                      Regenerate
                    </button>
                  </div>
                  <p class="mt-1 text-xs text-base-content/70">{summary.body}</p>
                  <p class="text-[10px] text-base-content/40">{summary.sourceLabel}</p>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </div>
    {:else if viewModel.codexSection === 'world'}
      <div class="grid gap-3 lg:grid-cols-2">
        <div class="rounded-xl border border-brass/20 bg-elevated p-3">
          <h4 class="font-display text-xs uppercase tracking-widest text-brass">Known</h4>
          <ul class="mt-2 flex flex-col gap-2">
            {#each viewModel.worldEntries as entry (entry.id)}
              <li>
                <p class="text-sm font-semibold text-base-content">
                  {entry.name}
                  <span class="ml-1 text-[10px] uppercase tracking-wide text-brass"
                    >{entry.kind}</span
                  >
                </p>
                <p class="text-xs text-base-content/70">{entry.detail}</p>
              </li>
            {/each}
          </ul>
        </div>
        <div class="rounded-xl border border-brass/20 bg-elevated p-3">
          <h4 class="font-display text-xs uppercase tracking-widest text-brass">Gallery</h4>
          <ul class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {#each viewModel.gallery as item (item.id)}
              <li
                class="flex h-24 items-end rounded-lg border border-brass/20 p-2 text-[10px] text-base-content/80"
                style="background: linear-gradient(180deg, oklch(0.22 0.04 {item.hue}) 0%, var(--ui-ink) 100%)"
              >
                {item.alt}
              </li>
            {/each}
          </ul>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
.nav-muted {
  color: color-mix(in oklab, var(--color-base-content) 60%, transparent);
}

.step-faint {
  color: color-mix(in oklab, var(--color-base-content) 45%, transparent);
}

.step-label-done {
  color: color-mix(in oklab, var(--color-base-content) 80%, transparent);
}
</style>

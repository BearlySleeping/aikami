<script lang="ts">
// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_content.svelte
//
// Shared character content for the standalone developer sheet and the
// production management workspace (C-551). Domain state remains in the
// ViewModel; edit disclosure and display mappings live in the sibling
// presentation module.

import { Modal, NumberStepper } from '@aikami/frontend/components';
import { ABILITY_KEYS } from '@aikami/types';
import m from '$lib/views/utils/i18n';
import {
  CHARACTER_NARRATIVE_CATEGORIES,
  CHARACTER_NARRATIVE_LABELS,
  CHARACTER_NARRATIVE_PROMPTS,
  CHARACTER_TRAIT_FIELDS,
  CHARACTER_TRAIT_LABELS,
  type CharacterSheetPresentationState,
  characterModifierTone,
  characterTabClass,
  formatModifier,
  submitNarrativeTrait,
} from './character_sheet_presentation.svelte';
import type { CharacterSheetViewModelInterface } from './character_sheet_view_model.svelte';

type Props = {
  viewModel: CharacterSheetViewModelInterface;
  presentation: CharacterSheetPresentationState;
  /** Developer-only JSON and AI context affordances. */
  developerTools?: boolean;
};

const { viewModel, presentation, developerTools = false }: Props = $props();
</script>

<div class="@container flex min-h-full w-full flex-col gap-3">
  {#if developerTools && viewModel.isProMode}
    <section class="game-surface--raised flex flex-col gap-3 rounded-lg p-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="game-eyebrow">Developer</p>
          <h3 class="game-section-title">JSON editor</h3>
        </div>
        <label class="flex cursor-pointer items-center gap-2">
          <span class="game-metadata">Edit JSON</span>
          <input
            type="checkbox"
            class="toggle"
            checked={viewModel.isJsonEditing}
            onchange={() => viewModel.toggleJsonEditing()}
          >
        </label>
      </div>
      {#if viewModel.isJsonEditing}
        <textarea
          class="textarea w-full font-mono text-sm"
          style="min-block-size: 16rem"
          value={viewModel.jsonText}
          aria-label="Character JSON"
          oninput={(event) => viewModel.setJsonText(event.currentTarget.value)}
        ></textarea>
        {#if viewModel.jsonError}
          <p class="game-numeric--negative" role="alert">{viewModel.jsonError}</p>
        {/if}
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn game-control--accent"
            onclick={() => viewModel.saveJsonEdit()}
          >
            Save & validate
          </button>
          <button
            type="button"
            class="btn game-control--quiet"
            onclick={() => viewModel.toggleJsonEditing()}
          >
            Cancel
          </button>
        </div>
      {:else}
        <pre
          class="game-surface--inset max-h-64 overflow-auto rounded-lg p-3 font-mono text-sm leading-relaxed"
        >{viewModel.jsonText}</pre>
      {/if}
    </section>
  {:else}
    <section
      class="game-character-summary game-surface--raised flex flex-col gap-3 rounded-lg p-3"
      data-testid="character-summary"
    >
      <div class="game-stat-grid">
        <div class="game-character-summary__stat game-surface--inset">
          <span class="game-eyebrow">Hit points</span>
          <strong class="game-numeric game-numeric--danger"
            >{viewModel.hp}
            / {viewModel.maxHp}</strong
          >
          <progress
            class="progress progress-error w-full"
            value={viewModel.hpPercent}
            max="100"
            aria-label="Hit points"
          ></progress>
        </div>
        <div class="game-character-summary__stat game-surface--inset">
          <span class="game-eyebrow">{m.character_ac()}</span>
          <strong class="game-numeric game-numeric--defense">{viewModel.totalDefense}</strong>
          <span class="game-metadata">Damage avoided</span>
        </div>
        <div class="game-character-summary__stat game-surface--inset">
          <span class="game-eyebrow">Attack</span>
          <strong class="game-numeric game-numeric--attack">{viewModel.totalAttack}</strong>
          <span class="game-metadata">With equipment</span>
        </div>
        <div class="game-character-summary__stat game-surface--inset">
          <span class="game-eyebrow">Experience</span>
          <strong class="game-numeric game-numeric--accent">
            {viewModel.xp}
            / {viewModel.xpToNext}
          </strong>
          <progress
            class="progress progress-accent w-full"
            value={viewModel.xpPercent}
            max="100"
            aria-label="Experience"
          ></progress>
        </div>
      </div>

      <div>
        <p class="game-eyebrow mb-2">Core abilities</p>
        <div class="game-ability-grid">
          {#each presentation.abilityRows(viewModel) as ability (ability.key)}
            <div class="game-ability-grid__item game-surface--inset">
              <span class="game-metadata">{ability.label}</span>
              <div class="flex items-baseline gap-1">
                <strong class="game-numeric game-numeric--emphasis">{ability.score}</strong>
                <span class={`game-numeric ${characterModifierTone(ability.modifier)}`}>
                  {formatModifier(ability.modifier)}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <div class="game-tabs" role="tablist" aria-label="Character details">
      <button
        type="button"
        role="tab"
        class={`game-tab ${characterTabClass(viewModel.activeTab, 'abilities')}`}
        aria-selected={viewModel.activeTab === 'abilities'}
        aria-controls="character-panel"
        onclick={() => viewModel.setActiveTab('abilities')}
      >
        Abilities
      </button>
      <button
        type="button"
        role="tab"
        class={`game-tab ${characterTabClass(viewModel.activeTab, 'skills')}`}
        aria-selected={viewModel.activeTab === 'skills'}
        aria-controls="character-panel"
        onclick={() => viewModel.setActiveTab('skills')}
      >
        Skills
      </button>
      <button
        type="button"
        role="tab"
        class={`game-tab ${characterTabClass(viewModel.activeTab, 'traits')}`}
        aria-selected={viewModel.activeTab === 'traits'}
        aria-controls="character-panel"
        onclick={() => viewModel.setActiveTab('traits')}
      >
        Traits
      </button>
      <button
        type="button"
        role="tab"
        class={`game-tab ${characterTabClass(viewModel.activeTab, 'features')}`}
        aria-selected={viewModel.activeTab === 'features'}
        aria-controls="character-panel"
        onclick={() => viewModel.setActiveTab('features')}
      >
        Features
      </button>
    </div>

    <section
      id="character-panel"
      class="game-surface--raised min-h-56 flex-1 rounded-lg p-3"
      role="tabpanel"
    >
      {#if viewModel.activeTab === 'abilities'}
        <div class="game-stat-grid">
          {#each presentation.abilityRows(viewModel) as ability (ability.key)}
            <div class="game-surface--inset flex flex-col gap-2 rounded-lg p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="game-body-text font-semibold">{ability.label}</span>
                <span class={`game-numeric ${characterModifierTone(ability.modifier)}`}>
                  {formatModifier(ability.modifier)}
                </span>
              </div>
              {#if presentation.isEditing}
                <NumberStepper
                  value={ability.score}
                  min={3}
                  max={20}
                  size="md"
                  class="game-number-stepper"
                  label="{ability.label} score"
                  onchange={(value) => viewModel.setAbilityScore(ability.key, value)}
                />
                <label class="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm"
                    checked={ability.isSavingThrowProficient}
                    aria-label={m.character_saving_throw_proficiency({ ability: ability.label })}
                    onchange={() => viewModel.toggleSaveProficiency(ability.key)}
                  >
                  <span class="game-metadata">{m.character_saving_throw()}</span>
                </label>
              {:else}
                <div class="flex items-center justify-between gap-2">
                  <strong class="game-numeric game-numeric--emphasis">{ability.score}</strong>
                  <span class="game-badge">
                    {m.character_saving_throw()}
                    {ability.isSavingThrowProficient ? ' ✓' : ' —'}
                  </span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else if viewModel.activeTab === 'skills'}
        <div class="flex flex-col gap-3">
          {#each ABILITY_KEYS as abilityKey (abilityKey)}
            {@const groupSkills = viewModel.skillsByAbility[abilityKey]}
            {#if groupSkills.length > 0}
              <section>
                <h3 class="game-eyebrow mb-2">{viewModel.abilityLabels[abilityKey]}</h3>
                <div class="grid gap-2 md:grid-cols-2">
                  {#each groupSkills as skill (skill.name)}
                    <div class="game-surface--inset flex items-center gap-3 rounded-lg p-2">
                      <div class="min-w-0 flex-1">
                        <p class="game-body-text truncate">{skill.name}</p>
                        <div class="mt-1 flex flex-wrap gap-1">
                          {#if skill.isExpertise}
                            <span class="game-badge game-badge--accent">Expertise</span>
                          {:else if skill.isProficient}
                            <span class="game-badge game-badge--positive">Proficient</span>
                          {:else}
                            <span class="game-badge">Untrained</span>
                          {/if}
                        </div>
                      </div>
                      <span class={`game-numeric ${characterModifierTone(skill.modifier)}`}>
                        {formatModifier(skill.modifier)}
                      </span>
                      {#if presentation.isEditing}
                        <div class="flex gap-2">
                          <input
                            type="checkbox"
                            class="checkbox checkbox-sm"
                            checked={skill.isProficient}
                            onchange={() => viewModel.toggleSkillProficiency(skill.name)}
                            aria-label="Proficiency in {skill.name}"
                          >
                          <input
                            type="checkbox"
                            class="checkbox checkbox-sm"
                            checked={skill.isExpertise}
                            onchange={() => viewModel.toggleSkillExpertise(skill.name)}
                            aria-label="Expertise in {skill.name}"
                          >
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
          {/each}
        </div>
      {:else if viewModel.activeTab === 'features'}
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="game-badge game-badge--accent">{viewModel.className}</span>
            <span class="game-metadata">Level {viewModel.level}</span>
          </div>
          <div>
            <h3 class="game-eyebrow mb-2">Known features</h3>
            <div class="grid gap-2 lg:grid-cols-2">
              {#each viewModel.classFeatures as feature (feature.id)}
                {#if feature.earned}
                  <article class="game-surface--inset rounded-lg p-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <h4 class="game-body-text font-semibold">{feature.name}</h4>
                      <span class="game-badge">{feature.kind}</span>
                    </div>
                    <p class="game-metadata mt-1">{feature.description}</p>
                    {#if feature.activation}
                      <p class="game-metadata mt-2">
                        Cost: {presentation.formatActivationCost(feature.activation.cost)}
                        {#if feature.activation.effectDice}
                          · {feature.activation.effectDice}
                        {/if}
                      </p>
                    {/if}
                  </article>
                {/if}
              {/each}
            </div>
            {#if !presentation.hasEarnedFeatures(viewModel.classFeatures)}
              <div class="game-empty game-empty--inline">
                <p class="game-body-text font-semibold">No features unlocked yet</p>
              </div>
            {/if}
          </div>
          <div>
            <h3 class="game-eyebrow mb-2">
              {viewModel.isMaxLevel ? 'Maximum level reached' : 'Next level features'}
            </h3>
            {#if viewModel.nextLevelFeatures.length > 0}
              <div class="grid gap-2 lg:grid-cols-2">
                {#each viewModel.nextLevelFeatures as feature (feature.id)}
                  <article class="game-surface--inset rounded-lg p-3 opacity-75">
                    <div class="flex flex-wrap items-center gap-2">
                      <span aria-hidden="true">🔒</span>
                      <h4 class="game-body-text font-semibold">{feature.name}</h4>
                      <span class="game-badge">{feature.kind}</span>
                    </div>
                    <p class="game-metadata mt-1">{feature.description}</p>
                    {#if feature.activation}
                      <p class="game-metadata mt-2">
                        Cost: {presentation.formatActivationCost(feature.activation.cost)}
                      </p>
                    {/if}
                  </article>
                {/each}
              </div>
            {:else}
              <p class="game-metadata">No further class features are authored.</p>
            {/if}
          </div>
        </div>
      {:else}
        <div class="grid gap-3 lg:grid-cols-2">
          {#each CHARACTER_TRAIT_FIELDS as field (field)}
            <section class="game-surface--inset rounded-lg p-3">
              <h3 id={`character-trait-label-${field}`} class="game-eyebrow">
                {CHARACTER_TRAIT_LABELS[field]}
              </h3>
              {#if presentation.isEditing}
                <textarea
                  id={`character-trait-${field}`}
                  aria-labelledby={`character-trait-label-${field}`}
                  class="textarea mt-2 w-full"
                  rows="3"
                  maxlength="500"
                  value={viewModel.traits[field]}
                  oninput={(event) => viewModel.setTrait(field, event.currentTarget.value)}
                ></textarea>
              {:else}
                <p class="game-body-text mt-2">
                  {viewModel.traits[field] || 'Not recorded yet.'}
                </p>
              {/if}
            </section>
          {/each}
        </div>

        <section class="mt-4">
          <h3 class="game-eyebrow mb-2">Narrative traits</h3>
          <div class="grid gap-3 lg:grid-cols-3">
            {#each CHARACTER_NARRATIVE_CATEGORIES as category}
              <div class="game-surface--inset rounded-lg p-3">
                <h4 class="game-metadata uppercase">{CHARACTER_NARRATIVE_LABELS[category]}</h4>
                <div class="mt-2 flex flex-wrap gap-1">
                  {#each viewModel.narrativeTraits[category] as trait}
                    <span class="game-badge">
                      {trait}
                      {#if presentation.isEditing}
                        <button
                          type="button"
                          class="game-inline-action"
                          onclick={() => viewModel.removeNarrativeTrait(category, trait)}
                          aria-label="Remove {trait}"
                        >
                          ×
                        </button>
                      {/if}
                    </span>
                  {/each}
                  {#if presentation.isEditing}
                    <form
                      class="flex w-full items-center gap-1"
                      onsubmit={(event) => submitNarrativeTrait(event, category, viewModel)}
                    >
                      <label class="sr-only" for={`character-narrative-${category}`}>
                        Add a {CHARACTER_NARRATIVE_PROMPTS[category]} trait
                      </label>
                      <input
                        id={`character-narrative-${category}`}
                        type="text"
                        class="input input-sm min-w-0 flex-1"
                        placeholder="Add a {CHARACTER_NARRATIVE_PROMPTS[category]} trait"
                      >
                      <button type="submit" class="btn btn-sm game-control--quiet">Add</button>
                    </form>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </section>

    <section class="game-surface--raised rounded-lg p-3" data-testid="character-equipment">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 class="game-eyebrow">Equipment</h3>
        <span class="game-metadata">{viewModel.equippedItems.length} equipped</span>
      </div>
      {#if viewModel.equippedItems.length === 0}
        <div class="game-empty game-empty--inline">
          <p class="game-body-text font-semibold">No equipment equipped</p>
          <p class="game-metadata">Items equipped from Inventory appear here.</p>
        </div>
      {:else}
        <div class="game-stat-grid">
          {#each viewModel.equippedItems as entry (entry.slot)}
            <div class="game-surface--inset flex items-center gap-3 rounded-lg p-2">
              <span class="text-xl" aria-hidden="true">{viewModel.getSlotIcon(entry.slot)}</span>
              <div class="min-w-0">
                <p class="game-metadata">{viewModel.getSlotLabel(entry.slot)}</p>
                <p class="game-body-text truncate font-semibold">{entry.definition.label}</p>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if developerTools}
    <div class="flex items-center justify-between border-t border-current/20 pt-2">
      <button
        type="button"
        class="btn btn-sm game-control--quiet"
        onclick={() => viewModel.toggleAiPreview()}
      >
        AI context preview
      </button>
      <kbd class="kbd kbd-sm">C</kbd>
    </div>
  {/if}
</div>

<Modal open={viewModel.showAiPreview} onclose={() => viewModel.toggleAiPreview()}>
  {#snippet title()}
    <h3 class="game-section-title">AI context preview</h3>
  {/snippet}
  {#snippet children()}
    <pre
      class="game-surface--inset max-h-96 overflow-auto whitespace-pre-wrap rounded-lg p-3 font-mono text-sm"
    >{viewModel.aiPreviewText}</pre>
  {/snippet}
  {#snippet actions()}
    <button
      type="button"
      class="btn game-control--quiet"
      onclick={() => viewModel.toggleAiPreview()}
    >
      Close
    </button>
  {/snippet}
</Modal>

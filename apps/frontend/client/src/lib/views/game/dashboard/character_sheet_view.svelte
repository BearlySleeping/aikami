<script lang="ts">
  // apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view.svelte
  //
  // Zero-logic tabbed D&D-style character sheet. Replaces the minimal
  // character dashboard from C-153. All state lives in the ViewModel.
  //
  // Contract: C-232 Character Sheet & Traits System
  import { Modal } from '@aikami/frontend/components';
  import { ABILITY_KEYS } from '$lib/data/character_sheet_types';
  import type { CharacterSheetViewModelInterface } from './character_sheet_view_model.svelte';

  type Props = {
    viewModel: CharacterSheetViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: fullscreen backdrop must be div -->
<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  role="button"
  tabindex="0"
  aria-label="Close character sheet"
  onclick={() => viewModel.closeSheet()}
  onkeydown={(e: KeyboardEvent) => e.key === 'Escape' && viewModel.closeSheet()}
>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: prevent backdrop close when clicking card -->
  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: card stops propagation only -->
  <div
    class="card w-full max-w-lg bg-base-100 shadow-2xl max-h-[90vh] overflow-y-auto"
    onclick={(e: MouseEvent) => e.stopPropagation()}
  >
    <div class="card-body p-4 gap-3">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-bold text-base-content">Character Sheet</h2>
          <span class="badge badge-primary badge-sm">{viewModel.level}</span>
        </div>
        <div class="flex items-center gap-2">
          <!-- Pro Mode Toggle -->
          <label class="flex items-center gap-1 cursor-pointer">
            <span class="text-xs text-base-content/50">Pro</span>
            <input
              type="checkbox"
              class="toggle toggle-xs"
              checked={viewModel.isProMode}
              onchange={() => viewModel.toggleProMode()}
            >
          </label>
          <button
            type="button"
            class="btn btn-sm btn-ghost btn-circle"
            onclick={() => viewModel.closeSheet()}
            aria-label="Close character sheet"
          >
            ✕
          </button>
        </div>
      </div>

      <div class="divider my-0"></div>

      {#if viewModel.isProMode}
        <!-- ── Pro Mode: JSON Editor ── -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-base-content/70">JSON Editor</span>
            <label class="flex items-center gap-1 cursor-pointer">
              <span class="text-xs text-base-content/50">Edit</span>
              <input
                type="checkbox"
                class="toggle toggle-xs"
                checked={viewModel.isJsonEditing}
                onchange={() => viewModel.toggleJsonEditing()}
              >
            </label>
          </div>
          {#if viewModel.isJsonEditing}
            <textarea
              class="textarea textarea-bordered font-mono text-xs h-64 leading-relaxed"
              value={viewModel.jsonText}
              oninput={(e: Event) => viewModel.setJsonText((e.target as HTMLTextAreaElement).value)}
            ></textarea>
            {#if viewModel.jsonError}
              <div class="text-xs text-error font-mono">{viewModel.jsonError}</div>
            {/if}
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-sm btn-primary"
                onclick={() => viewModel.saveJsonEdit()}
              >
                Save & Validate
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onclick={() => viewModel.toggleJsonEditing()}
              >
                Cancel
              </button>
            </div>
          {:else}
            <pre
              class="bg-base-200 rounded-lg p-3 text-xs font-mono leading-relaxed overflow-x-auto max-h-64"
            >{viewModel.jsonText}</pre>
          {/if}
        </div>
      {:else}
        <!-- ── Tabs ── -->
        <div role="tablist" class="tabs tabs-bordered">
          <button
            type="button"
            role="tab"
            class="tab tab-sm {viewModel.activeTab === 'abilities' ? 'tab-active' : ''}"
            onclick={() => viewModel.setActiveTab('abilities')}
          >
            Abilities
          </button>
          <button
            type="button"
            role="tab"
            class="tab tab-sm {viewModel.activeTab === 'skills' ? 'tab-active' : ''}"
            onclick={() => viewModel.setActiveTab('skills')}
          >
            Skills
          </button>
          <button
            type="button"
            role="tab"
            class="tab tab-sm {viewModel.activeTab === 'traits' ? 'tab-active' : ''}"
            onclick={() => viewModel.setActiveTab('traits')}
          >
            Traits
          </button>
        </div>

        <!-- ── Tab Content ── -->
        {#if viewModel.activeTab === 'abilities'}
          <!-- Abilities Tab -->
          <div class="grid grid-cols-3 gap-2">
            {#each ABILITY_KEYS as key}
              {@const ability = viewModel.abilities[key]}
              {@const label = viewModel.abilityLabels[key]}
              <div class="stat bg-base-200 rounded-lg p-2">
                <div class="stat-title text-xs opacity-60">{label}</div>
                <div class="flex items-center gap-1">
                  <input
                    type="number"
                    class="input input-xs input-bordered w-14 text-center font-mono text-sm"
                    min="3"
                    max="20"
                    value={ability.value}
                    oninput={(e: Event) =>
                      viewModel.setAbilityScore(key, Number((e.target as HTMLInputElement).value))}
                  >
                  <span
                    class="text-xs font-mono font-bold {viewModel.modifierColor(ability.modifier)}"
                  >
                    {viewModel.modifierSign(ability.modifier)}
                  </span>
                </div>
                <!-- Save Proficiency -->
                <label class="flex items-center gap-1 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    checked={viewModel.savingThrows.find((s) => s.ability === key)
                      ?.isProficient ?? false}
                    onchange={() => viewModel.toggleSaveProficiency(key)}
                  >
                  <span class="text-[10px] text-base-content/50">Save</span>
                </label>
              </div>
            {/each}
          </div>
        {:else if viewModel.activeTab === 'skills'}
          <!-- Skills Tab -->
          <div class="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
            {#each ABILITY_KEYS as abilityKey}
              {@const groupSkills = viewModel.skillsByAbility[abilityKey]}
              {#if groupSkills.length > 0}
                <div class="text-xs font-semibold text-base-content/50 uppercase">
                  {viewModel.abilityLabels[abilityKey]}
                </div>
                {#each groupSkills as skill}
                  <div class="flex items-center justify-between bg-base-200 rounded-lg px-2 py-1">
                    <div class="flex items-center gap-1 min-w-0">
                      <span class="text-xs truncate">{skill.name}</span>
                      {#if skill.isExpertise}
                        <span class="text-[10px] text-warning">★★</span>
                      {:else if skill.isProficient}
                        <span class="text-[10px] text-success">★</span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                      <span
                        class="text-xs font-mono font-bold {viewModel.modifierColor(skill.modifier)}"
                      >
                        {viewModel.modifierSign(skill.modifier)}
                      </span>
                      <!-- proficiency checkbox -->
                      <input
                        type="checkbox"
                        class="checkbox checkbox-xs"
                        checked={skill.isProficient}
                        onchange={() => viewModel.toggleSkillProficiency(skill.name)}
                        aria-label="Proficiency in {skill.name}"
                      >
                      <!-- expertise checkbox -->
                      <input
                        type="checkbox"
                        class="checkbox checkbox-xs [--chkfg:var(--fallback-wa,oklch(var(--wa)))]"
                        checked={skill.isExpertise}
                        onchange={() => viewModel.toggleSkillExpertise(skill.name)}
                        aria-label="Expertise in {skill.name}"
                        title="Expertise"
                      >
                    </div>
                  </div>
                {/each}
              {/if}
            {/each}
          </div>
        {:else if viewModel.activeTab === 'traits'}
          <!-- Traits Tab -->
          <div class="flex flex-col gap-3">
            <!-- Personality / Ideals / Bonds / Flaws -->
            <div class="flex flex-col gap-2">
              <div>
                <label class="text-xs font-semibold text-base-content/70">
                  Personality Traits
                  <textarea
                    class="textarea textarea-bordered textarea-xs w-full mt-1 text-xs"
                    rows="2"
                    maxlength="500"
                    value={viewModel.traits.personalityTraits}
                    oninput={(e: Event) =>
                      viewModel.setTrait('personalityTraits', (e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                </label>
              </div>
              <div>
                <label class="text-xs font-semibold text-base-content/70">
                  Ideals
                  <textarea
                    class="textarea textarea-bordered textarea-xs w-full mt-1 text-xs"
                    rows="2"
                    maxlength="500"
                    value={viewModel.traits.ideals}
                    oninput={(e: Event) =>
                      viewModel.setTrait('ideals', (e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                </label>
              </div>
              <div>
                <label class="text-xs font-semibold text-base-content/70">
                  Bonds
                  <textarea
                    class="textarea textarea-bordered textarea-xs w-full mt-1 text-xs"
                    rows="2"
                    maxlength="500"
                    value={viewModel.traits.bonds}
                    oninput={(e: Event) =>
                      viewModel.setTrait('bonds', (e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                </label>
              </div>
              <div>
                <label class="text-xs font-semibold text-base-content/70">
                  Flaws
                  <textarea
                    class="textarea textarea-bordered textarea-xs w-full mt-1 text-xs"
                    rows="2"
                    maxlength="500"
                    value={viewModel.traits.flaws}
                    oninput={(e: Event) =>
                      viewModel.setTrait('flaws', (e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                </label>
              </div>
            </div>

            <div class="divider my-0"></div>

            <!-- Narrative Traits -->
            <div>
              <h3 class="text-xs font-semibold text-base-content/70 mb-2">Narrative Traits</h3>
              {#each (['likes', 'temptations', 'keys'] as const) as category}
                <div class="mb-2">
                  <span class="text-[11px] font-semibold uppercase text-base-content/50"
                    >{category}</span
                  >
                  <div class="flex flex-wrap gap-1 mt-1">
                    {#each viewModel.narrativeTraits[category] as trait}
                      <span class="badge badge-sm gap-1">
                        {trait}
                        <button
                          type="button"
                          class="cursor-pointer text-base-content/40 hover:text-error"
                          onclick={() => viewModel.removeNarrativeTrait(category, trait)}
                          aria-label="Remove {trait}"
                        >
                          ✕
                        </button>
                      </span>
                    {/each}
                    <form
                      class="flex items-center gap-1"
                      onsubmit={(e: Event) => {
                        e.preventDefault();
                        const input = (e.target as HTMLFormElement)
                          .querySelector('input') as HTMLInputElement;
                        viewModel.addNarrativeTrait(category, input.value);
                        input.value = '';
                      }}
                    >
                      <input
                        type="text"
                        class="input input-xs input-bordered w-24 text-xs"
                        placeholder="Add..."
                      >
                      <button type="submit" class="btn btn-xs btn-ghost">+</button>
                    </form>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="divider my-0"></div>

        <!-- Game Stats Summary -->
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-base-200 rounded-lg p-2 flex flex-col gap-1">
            <div class="flex justify-between items-center">
              <span class="text-xs opacity-60">HP</span>
              <span class="text-xs font-mono font-bold text-error"
                >{viewModel.hp}
                / {viewModel.maxHp}</span
              >
            </div>
            <progress
              class="progress progress-error w-full h-1"
              value={viewModel.hpPercent}
              max="100"
            ></progress>
          </div>
          <div class="bg-base-200 rounded-lg p-2 flex flex-col gap-1">
            <div class="flex justify-between items-center">
              <span class="text-xs opacity-60">XP</span>
              <span class="text-xs font-mono font-bold text-accent"
                >{viewModel.xp}
                / {viewModel.xpToNext}</span
              >
            </div>
            <progress
              class="progress progress-accent w-full h-1"
              value={viewModel.xpPercent}
              max="100"
            ></progress>
          </div>
          <div class="stat bg-base-200 rounded-lg p-2">
            <div class="stat-title text-[10px] opacity-60">Attack</div>
            <div class="stat-value text-sm text-warning">{viewModel.totalAttack}</div>
          </div>
          <div class="stat bg-base-200 rounded-lg p-2">
            <div class="stat-title text-[10px] opacity-60">Defense</div>
            <div class="stat-value text-sm text-info">{viewModel.totalDefense}</div>
          </div>
        </div>

        <!-- Equipment Slots -->
        <div>
          <h3 class="text-xs font-semibold text-base-content/70 mb-2">Equipment</h3>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-lg bg-base-200 p-2 flex items-center gap-2">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-md {viewModel.equippedWeaponDef ? 'bg-warning/20' : 'bg-base-300'}"
              >
                <span class="text-sm">{viewModel.equippedWeaponDef ? '⚔️' : '🗡️'}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[10px] opacity-50">Weapon</div>
                <div class="text-xs font-medium truncate">
                  {viewModel.equippedWeaponDef?.label ?? 'Empty'}
                </div>
                {#if viewModel.equippedWeaponDef}
                  <div class="text-[10px] text-warning">
                    +{viewModel.equippedWeaponDef.attackBonus}
                    ATK
                  </div>
                {/if}
              </div>
            </div>
            <div class="rounded-lg bg-base-200 p-2 flex items-center gap-2">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-md {viewModel.equippedArmorDef ? 'bg-info/20' : 'bg-base-300'}"
              >
                <span class="text-sm">{viewModel.equippedArmorDef ? '🛡️' : '👕'}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[10px] opacity-50">Armor</div>
                <div class="text-xs font-medium truncate">
                  {viewModel.equippedArmorDef?.label ?? 'Empty'}
                </div>
                {#if viewModel.equippedArmorDef}
                  <div class="text-[10px] text-info">
                    +{viewModel.equippedArmorDef.defenseBonus}
                    DEF
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Footer -->
      <div class="divider my-0"></div>
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="btn btn-xs btn-ghost"
          onclick={() => viewModel.toggleAiPreview()}
        >
          AI Context Preview
        </button>
        <kbd class="kbd kbd-xs text-[10px] opacity-60">C</kbd>
      </div>
    </div>
  </div>
</div>

<!-- AI Context Preview Modal -->
<Modal open={viewModel.showAiPreview} onclose={() => viewModel.toggleAiPreview()}>
  {#snippet title()}
    <h3 class="text-lg font-bold">AI Context Preview</h3>
  {/snippet}
  {#snippet children()}
    <pre
      class="bg-base-200 rounded-lg p-3 text-xs font-mono leading-relaxed overflow-x-auto max-h-96 whitespace-pre-wrap"
    >{viewModel.aiPreviewText}</pre>
  {/snippet}
  {#snippet actions()}
    <button type="button" class="btn btn-sm" onclick={() => viewModel.toggleAiPreview()}>
      Close
    </button>
  {/snippet}
</Modal>

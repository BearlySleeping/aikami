<script lang="ts">
  // apps/frontend/pwa/src/lib/components/chat/StatsPanel.svelte
  type Stats = {
    hp?: number;
    ac?: number;
    level?: number;
    class?: string;
    abilities?: Record<string, { score: number; modifier: number }>;
  };

  type Props = {
    stats?: Stats;
    npcName?: string;
    isExpanded?: boolean;
    onToggle?: () => void;
  };

  let { stats = {}, npcName = 'NPC', isExpanded = false, onToggle }: Props = $props();

  const abilityNames: Record<string, string> = {
    strength: 'STR',
    dexterity: 'DEX',
    constitution: 'CON',
    intelligence: 'INT',
    wisdom: 'WIS',
    charisma: 'CHA',
  };
</script>

<div class="card bg-base-200 shadow-xl">
  <div class="card-body p-4">
    <div class="flex items-center justify-between cursor-pointer" onclick={onToggle}>
      <h3 class="card-title text-sm">{npcName} Stats</h3>
      <button class="btn btn-xs btn-ghost">{isExpanded ? '▼' : '▶'}</button>
    </div>

    {#if !isExpanded}
      <div class="flex gap-4 text-sm">
        {#if stats.hp}
          <div class="stat p-0">
            <div class="stat-title text-xs">HP</div>
            <div class="stat-value text-lg">{stats.hp}</div>
          </div>
        {/if}
        {#if stats.ac}
          <div class="stat p-0">
            <div class="stat-title text-xs">AC</div>
            <div class="stat-value text-lg">{stats.ac}</div>
          </div>
        {/if}
        {#if stats.level}
          <div class="stat p-0">
            <div class="stat-title text-xs">LVL</div>
            <div class="stat-value text-lg">{stats.level}</div>
          </div>
        {/if}
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-2 mt-2">
        {#if stats.class}
          <div class="col-span-2 text-sm"><strong>Class:</strong> {stats.class}</div>
        {/if}
        {#if stats.hp}
          <div class="text-sm"><strong>HP:</strong> {stats.hp}</div>
        {/if}
        {#if stats.ac}
          <div class="text-sm"><strong>AC:</strong> {stats.ac}</div>
        {/if}

        {#if stats.abilities}
          <div class="col-span-2 mt-2">
            <strong>Abilities:</strong>
            <div class="grid grid-cols-3 gap-1 mt-1">
              {#each Object.entries(stats.abilities) as [ ability, value ]}
                <div class="text-xs bg-base-300 p-1 rounded">
                  {abilityNames[ability] || ability}:
                  {value.score}
                  ({value.modifier >= 0 ? '+' : ''}{value.modifier})
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

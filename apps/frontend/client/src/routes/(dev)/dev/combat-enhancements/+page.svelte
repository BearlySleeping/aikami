<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/combat-enhancements/+page.svelte
  // C-234 Dev Sandbox — Combat Enhancements (Dice & Initiative)
  //
  // Standalone sandbox for testing the 5 new UI features without the
  // full combat split-screen layout:
  // 1. Multi-dice quick menu
  // 2. Initiative tracker
  // 3. Turn tracking header
  // 4. Enriched combat log
  // 5. Quick-dice in chat (tested via simulated dialogue)
  //
  // Uses a local mock state — no bridge, no engine.

  import { onMount } from 'svelte';
  import DiceQuickMenu from '$views/combat/components/dice_quick_menu.svelte';
  import EnrichedLogEntry from '$views/combat/components/enriched_log_entry.svelte';
  import InitiativeTracker from '$views/combat/components/initiative_tracker.svelte';
  import TurnTrackerHeader from '$views/combat/components/turn_tracker_header.svelte';
  import type {
    DiceNotation,
    EnrichedCombatLogEntry,
    InitiativeEntry,
    QueuedRoll,
    TurnState,
  } from '$views/combat/types/combat_enhancements.ts';
  import { parseDamageFromLog, parseDiceFromLog } from '$views/combat/utils/dice_notation.ts';

  // ── Mock state ──
  let queuedRolls: QueuedRoll[] = $state([]);
  let isRolling = $state(false);
  let rollCounter = 0;

  let initiativeEntries: InitiativeEntry[] = $state([
    {
      entityId: 1,
      name: 'Player',
      initiative: 18,
      currentHp: 75,
      maxHp: 100,
      isCurrentTurn: true,
      isDefeated: false,
    },
    {
      entityId: 2,
      name: 'Goblin',
      initiative: 14,
      currentHp: 42,
      maxHp: 80,
      isCurrentTurn: false,
      isDefeated: false,
    },
    {
      entityId: 3,
      name: 'Skeleton',
      initiative: 10,
      currentHp: 0,
      maxHp: 50,
      isCurrentTurn: false,
      isDefeated: true,
    },
  ]);

  let turnState: TurnState | null = $state({
    currentEntityId: 1,
    currentEntityName: 'Player',
    isPlayerTurn: true,
    actionEconomy: { action: false, bonusAction: false, reaction: false },
    turnNumber: 3,
  });

  let actionEconomy = $derived(
    turnState?.actionEconomy ?? { action: false, bonusAction: false, reaction: false },
  );

  let testLogText = $state('Player rolls 18 (+5 = 23) to hit for 12 slashing damage');

  // ── Helpers ──
  const getEnrichedEntry = (text: string): EnrichedCombatLogEntry => {
    const dice = parseDiceFromLog(text);
    const damage = parseDamageFromLog(text);
    return {
      rawText: text,
      isPlainText: !dice,
      ...dice,
      ...damage,
    };
  };

  const queueRoll = (options: { notation: DiceNotation; label: string }): void => {
    rollCounter++;
    queuedRolls = [
      ...queuedRolls,
      {
        id: `q-${rollCounter}`,
        notation: options.notation,
        label: options.label,
        timestamp: Date.now(),
      },
    ];
  };

  const removeQueuedRoll = (id: string): void => {
    queuedRolls = queuedRolls.filter((r) => r.id !== id);
  };

  const resolveAllRolls = (): void => {
    if (queuedRolls.length === 0) {
      return;
    }
    isRolling = true;
    setTimeout(() => {
      queuedRolls = [];
      isRolling = false;
    }, 1500);
  };

  const cycleTurn = (): void => {
    if (!turnState) {
      return;
    }
    const nextId = turnState.currentEntityId === 1 ? 2 : 1;
    turnState = {
      currentEntityId: nextId,
      currentEntityName: nextId === 1 ? 'Player' : 'Goblin',
      isPlayerTurn: nextId === 1,
      actionEconomy: { action: false, bonusAction: false, reaction: false },
      turnNumber: turnState.turnNumber + 1,
    };
    initiativeEntries = initiativeEntries.map((e) => ({
      ...e,
      isCurrentTurn: e.entityId === nextId,
    }));
  };

  const toggleDefeated = (): void => {
    initiativeEntries = initiativeEntries.map((e) => {
      if (e.entityId === 2) {
        return { ...e, isDefeated: !e.isDefeated, currentHp: e.isDefeated ? 42 : 0 };
      }
      return e;
    });
  };

  const toggleActionEconomy = (type: 'action' | 'bonusAction' | 'reaction'): void => {
    if (!turnState) {
      return;
    }
    turnState = {
      ...turnState,
      actionEconomy: { ...turnState.actionEconomy, [type]: !turnState.actionEconomy[type] },
    };
  };

  onMount(() => {
    // No bridge initialization needed — pure sandbox
  });
</script>

<svelte:head>
  <title>Combat Enhancements Dev — Aikami</title>
</svelte:head>

<div class="mx-auto max-w-4xl p-6 space-y-8">
  <h1 class="text-xl font-bold text-base-content">🎲 Combat Enhancements — Dev Sandbox</h1>
  <p class="text-sm text-base-content/50">
    5 new UI features: dice menu, initiative tracker, turn header, enriched log, quick-dice popover.
  </p>

  <!-- ── 1. Dice Quick Menu ── -->
  <section class="rounded-lg border border-base-300 bg-base-100 p-4">
    <h2 class="mb-3 text-sm font-semibold text-base-content/70">1. Dice Quick Menu</h2>
    <DiceQuickMenu
      {queuedRolls}
      onQueueRoll={({ notation, label }) => queueRoll({ notation, label })}
      onRemoveQueuedRoll={removeQueuedRoll}
      onRollAll={resolveAllRolls}
      {isRolling}
    />
  </section>

  <!-- ── 2. Initiative Tracker ── -->
  <section class="rounded-lg border border-base-300 bg-base-100 p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-base-content/70">2. Initiative Tracker</h2>
      <button class="btn btn-outline btn-xs" onclick={toggleDefeated}>
        Toggle Goblin Defeated
      </button>
    </div>
    <InitiativeTracker entries={initiativeEntries} />
  </section>

  <!-- ── 3. Turn Tracker Header ── -->
  <section class="rounded-lg border border-base-300 bg-base-100 p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-base-content/70">3. Turn Tracker Header</h2>
      <div class="flex gap-2">
        <button class="btn btn-outline btn-xs" onclick={cycleTurn}>Cycle Turn</button>
        <button class="btn btn-outline btn-xs" onclick={() => toggleActionEconomy('action')}>
          Toggle Action
        </button>
        <button class="btn btn-outline btn-xs" onclick={() => toggleActionEconomy('bonusAction')}>
          Toggle Bonus
        </button>
        <button class="btn btn-outline btn-xs" onclick={() => toggleActionEconomy('reaction')}>
          Toggle Reaction
        </button>
      </div>
    </div>
    <TurnTrackerHeader
      {turnState}
      {actionEconomy}
      onEndTurn={cycleTurn}
      isEndTurnDisabled={false}
    />
  </section>

  <!-- ── 4. Enriched Log Entry ── -->
  <section class="rounded-lg border border-base-300 bg-base-100 p-4">
    <h2 class="mb-3 text-sm font-semibold text-base-content/70">4. Enriched Combat Log</h2>
    <div class="mb-2 flex gap-2">
      <input
        type="text"
        bind:value={testLogText}
        class="input input-bordered input-sm flex-1 font-mono text-xs"
      >
    </div>
    <div class="rounded-lg border border-base-200 bg-base-200 p-3">
      <div class="mb-1 text-xs text-base-content/50">
        Input: <code class="font-mono">{testLogText}</code>
      </div>
      <div class="text-sm">
        <EnrichedLogEntry entry={getEnrichedEntry(testLogText)} />
      </div>
    </div>

    <div class="mt-3 space-y-1">
      <p class="text-xs font-semibold text-base-content/50">Preset test strings:</p>
      <div class="flex flex-wrap gap-1">
        {#each ['Player rolls 18 for 12 slashing damage', 'Player rolls 5 — Miss!', 'Critical hit! Player deals 30 piercing damage!', 'Enemy attacks with fire breath for 22 fire damage', 'Player rolls 20 with advantage for 15 radiant damage'] as preset}
          <button class="btn btn-ghost btn-xs font-mono" onclick={() => (testLogText = preset)}>
            {preset.split(' ').slice(0, 3).join(' ')}…
          </button>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── Preset: Quick-Dice Log Example ── -->
  <section class="rounded-lg border border-base-300 bg-base-100 p-4">
    <h2 class="mb-3 text-sm font-semibold text-base-content/70">
      5. Full Example (Dice + Enriched Log)
    </h2>
    <div class="space-y-1">
      {#each [
        'Player rolls 18 (+5 = 23) for 12 slashing damage',
        'Goblin rolls 5 (+2 = 7) — Miss!',
        'Critical hit! Player rolls 20 for 30 piercing damage',
        'Enemy casts fire breath — 22 fire damage',
      ] as logText}
        <div class="rounded border-b border-base-200 px-2 py-1">
          <EnrichedLogEntry entry={getEnrichedEntry(logText)} />
        </div>
      {/each}
    </div>
  </section>
</div>

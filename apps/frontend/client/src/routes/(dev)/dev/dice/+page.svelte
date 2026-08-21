<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/dice/+page.svelte
//
// Dev sandbox for the shared DiceCard component (C-421) — renders the card
// in controlled states: flat roll, check success, check failure, crit.
import DiceCard from '$lib/components/game/dice_card.svelte';
import DiceHistoryFeed from '$lib/views/game/ui/overlays/pause_menu/dice_history_feed.svelte';

const now = new Date().toISOString();

const flatRoll = {
  id: 'flat-1',
  notation: '2d6+3',
  dice: [
    { sides: 6, value: 4 },
    { sides: 6, value: 5 },
  ],
  modifier: 3,
  total: 12,
  isCriticalSuccess: false,
  isCriticalFailure: false,
  timestamp: now,
};

const checkSuccess = {
  id: 'check-1',
  notation: '1d20+3',
  dice: [{ sides: 20, value: 20 }],
  modifier: 3,
  total: 23,
  check: { dc: 15, success: true, difference: 8, ability: 'Persuasion' },
  isCriticalSuccess: true,
  isCriticalFailure: false,
  timestamp: now,
};

const checkFailure = {
  id: 'check-2',
  notation: '1d20-1',
  dice: [{ sides: 20, value: 2 }],
  modifier: -1,
  total: 1,
  check: { dc: 15, success: false, difference: -14 },
  isCriticalSuccess: false,
  isCriticalFailure: false,
  timestamp: now,
};

const sampleHistory = [
  {
    roll: 20,
    sides: 20,
    modifier: 3,
    total: 23,
    timestamp: new Date(),
    notation: '1d20+3',
    dc: 15,
    success: true,
    isCriticalSuccess: true,
    isCriticalFailure: false,
    label: 'Persuasion',
  },
  {
    roll: 9,
    sides: 6,
    modifier: 0,
    total: 9,
    timestamp: new Date(),
    notation: '2d6',
  },
];
</script>

<div class="mx-auto max-w-md space-y-6 p-8">
  <h1 class="text-xl font-bold">DiceCard Sandbox (C-421)</h1>

  <section>
    <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/60">
      Flat roll — 2d6+3 = 12
    </h2>
    <DiceCard card={flatRoll} />
  </section>

  <section>
    <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/60">
      Check success — Nat 20 + 3 = 23 vs DC 15 ✓
    </h2>
    <DiceCard card={checkSuccess} />
  </section>

  <section>
    <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/60">
      Check failure — 2 - 1 = 1 vs DC 15 ✗
    </h2>
    <DiceCard card={checkFailure} />
  </section>

  <section>
    <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/60">
      Roll History Feed (AC-4)
    </h2>
    <DiceHistoryFeed entries={sampleHistory} onClose={() => {}} />
  </section>
</div>

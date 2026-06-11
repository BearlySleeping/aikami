<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/combat/+page.svelte
  //
  // Sandbox route for CombatViewModel + DevTools
  // NEVER import production ViewModels or services here.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import { getCombatDevViewModel } from '$views/combat/combat_dev_view_model.svelte';
  import CombatView from '$views/combat/combat_view.svelte';

  const viewModel = getCombatDevViewModel({
    className: 'CombatDevViewModel',
  });

  /** Dev tools actions wired to CombatDevViewModel sandbox methods. */
  const devActions = [
    {
      label: 'Force Player HP to 1',
      onClick: () => viewModel.forcePlayer1HP(),
    },
    {
      label: 'Simulate Enemy Turn',
      onClick: () => viewModel.simulateEnemyTurn(),
    },
    {
      label: 'Simulate Player Attack',
      onClick: () => viewModel.simulatePlayerAttack(),
    },
    {
      label: 'End Battle (Victory)',
      onClick: () => viewModel.endBattle(true),
    },
    {
      label: 'End Battle (Defeat)',
      onClick: () => viewModel.endBattle(false),
    },
    {
      label: 'Reset Combat',
      onClick: () => viewModel.resetCombat(),
    },
  ];
</script>

<CombatView {viewModel} />

<DevToolsPanel actions={devActions} />

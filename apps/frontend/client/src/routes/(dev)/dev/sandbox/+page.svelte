<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/sandbox/+page.svelte
  // Extends /game — reuses the same GameView + GameViewModel + GameUIViewModel
  // infrastructure, but seeds localStorage with a mock persona so a character
  // loads instantly without needing to go through the character creation flow.
  import { browser } from '$app/environment';
  import GameView from '$lib/views/game/canvas/game_view.svelte';
  import { GameViewModel } from '$lib/views/game/canvas/game_view_model.svelte';
  import { GameUIViewModel } from '$lib/views/game/ui/game_ui_view_model.svelte';

  // Seed a mock persona into localStorage before the GameViewModel loads.
  // This gives the engine an active character with LPC layer IDs [1,2,3,4,5]
  // which maps to body, hair, torso, legs, feet layers through the recipe resolver.
  //
  // Must run synchronously before the GameViewModel constructor reads localStorage,
  // so this is a module-level side effect guarded by the 'browser' check.
  if (browser) {
    const existing = localStorage.getItem('aikami-characters');
    if (!existing?.includes('Sandbox Adventurer')) {
      const mockCharacters = [
        {
          persona: {
            id: crypto.randomUUID(),
            name: 'Sandbox Adventurer',
            race: 'Human',
            class: 'Fighter',
            level: 1,
            alignment: 'Neutral Good',
            background: 'A wandering test subject exploring the sandbox.',
            abilityScores: {
              strength: 15,
              dexterity: 13,
              constitution: 14,
              intelligence: 10,
              wisdom: 12,
              charisma: 8,
            },
            appearance: {
              physicalDescription: 'A stout human fighter in simple gear.',
            },
            hitPoints: 12,
            hitPointsMax: 12,
            temporaryHitPoints: 0,
            armorClass: 15,
            speed: 30,
            experiencePoints: 0,
            savingThrows: [],
            skills: [],
            proficiencies: [],
            languages: ['Common'],
            equipment: [],
            inventory: [],
            isActive: true,
          },
          avatarUrl: '',
          savedAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem('aikami-characters', JSON.stringify(mockCharacters));
    }
  }

  const viewModel = new GameViewModel({ className: 'GameViewModel' });
  const gameUIViewModel = new GameUIViewModel({
    className: 'GameUIViewModel',
    gameViewModel: viewModel,
  });
</script>

<GameView {viewModel} {gameUIViewModel} />

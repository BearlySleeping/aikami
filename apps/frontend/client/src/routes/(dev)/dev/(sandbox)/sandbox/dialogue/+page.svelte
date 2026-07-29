<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/sandbox/dialogue/+page.svelte
//
// Isolated Dialogue Action Menu & Interactive Dice sandbox with devtools.
// Mounts the DialogueOverlay with DialogueDevViewModel for testing C-162:
//   - Action context menu (Persuasion/Intimidation/Stealth/Attack/Custom)
//   - Interactive d20 click-to-roll with controlled outcomes
//   - Toggle between mock AI and real LLM extraction
//   - NPC persona presets (sage, guard, innkeeper, blacksmith, bandit, merchant)
//   - Interaction mode switch (menu vs freeform)
//
// Contract: C-162 BG3 Action Menu & Dice

import { browser } from '$app/environment';
import { NpcIntentAnalysisOutputSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { aiGatewayService } from '$services';
import DialogueOverlay from '$lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte';
import {
  type DevInteractionMode,
  type DevNpcPreset,
  DialogueDevViewModel,
  type DialogueDevViewModelInterface,
  type DiceOutcome,
} from '$lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.dev.svelte.ts';

/** Navigate back to sandbox index on End Chat / combat transition. */
const goBack = () => {
  if (browser) {
    window.history.back();
  }
};

const MOCK_NPC_DATA = {
  npcId: 'sandbox-elder',
  npcName: 'Elder Thrain',
  dialog: 'Ah, a traveler! Welcome to our humble village. How may I be of assistance?',
  personaId: 'sage',
};

const viewModel: DialogueDevViewModelInterface = DialogueDevViewModel.create({
  className: 'DialogueSandboxVM',
  npcData: MOCK_NPC_DATA,
  onEndChat: goBack,
  npcDialogueService: {
    _className: 'DevMockNpcDialogueService',
    dispose: async () => {},
    activeNpc: undefined,
    startDialogue: () => {},
    endDialogue: () => {},
    generateTurn: async () => ({
      narrative: '[Dev mock AI response]',
      choices: [
        { id: 'talk', label: 'Ask about the ward' },
        { id: 'leave', label: 'Leave' },
      ],
      source: 'ai',
    }),
    wasCommandExecuted: () => false,
    markCommandExecuted: () => {},
    configure: () => {},
    deriveAllowedCommands: () => ['trade', 'offerQuest', 'skillCheck', 'giveItem'],
    buildContext: () => ({
      persona: 'You are a dev sandbox NPC.',
      npcName: 'Elder Thrain',
      memory: [],
      gameStateFacts: [],
      relationshipFacts: [],
      allowedCommands: ['trade', 'offerQuest', 'skillCheck', 'giveItem'],
    }),
    executeCommand: () => true,
    analyzeIntent: async (opts: {
      npcId: string;
      npcName: string;
      messages: Array<{ role: 'player' | 'npc'; content: string }>;
      signal: AbortSignal;
      gameStateFacts?: string[];
      playerContext?: { character_sheet_summary: string; level: number; class_id: string };
    }) => {
      if (!viewModel.useMockAi) {
        // ── Real LLM path ────────────────────────────────────────
        const playerMsg = opts.messages.filter((m) => m.role === 'player').pop();
        const input = {
          player_input: playerMsg?.content ?? '',
          npc_context: {
            name: opts.npcName,
            persona: `You are ${opts.npcName}, a character in a fantasy world.`,
            allowed_commands: ['trade', 'offerQuest', 'skillCheck', 'giveItem'],
          },
          player_context: opts.playerContext ?? {
            character_sheet_summary: 'Level 1 Fighter',
            level: 1,
            class_id: 'fighter',
          },
          recent_history: opts.messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content.slice(0, 200),
          })),
          game_state_facts: opts.gameStateFacts ?? [],
        };

        const systemPrompt = [
          'You are a game master assistant analyzing player intent in an RPG dialogue.',
          'Given the player\'s message and NPC context, determine:',
          '1. Whether this action requires a skill check (dice roll).',
          '2. If so, what skill to check, what difficulty class (5-20), and what stat modifier applies.',
          '3. The NPC\'s spoken response — write in FIRST-PERSON as the NPC speaking directly to the player.\n' +
          '   Include actions in asterisks for flavor (e.g. *strokes beard* "Ah, a fine question!").\n' +
          '   NEVER write third-person narration like "The elder considers your words."',
          '4. 0-4 contextual suggestion chips for the player.',
          '',
          'Be conservative: only require a roll when the player is clearly attempting',
          'persuasion, deception, intimidation, stealth, or another skill-based action.',
          'Everyday conversation does NOT need a roll.',
          '',
          'Respond with a JSON object matching the NpcIntentAnalysisOutput schema.',
        ].join('\n');

        try {
          const result = await aiGatewayService.generateText({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: JSON.stringify(input) },
            ],
            schema: NpcIntentAnalysisOutputSchema as unknown as Record<string, unknown>,
            schemaName: 'NpcIntentAnalysisOutput',
            signal: opts.signal,
          });

          const raw = result.structured ?? {};
          if (Value.Check(NpcIntentAnalysisOutputSchema, raw)) {
            return raw;
          }

          // Structured output failed — try to salvage narrative from raw text
          const rawText = result.text?.trim();
          let narrative = rawText || '';
          let chips: Array<{ id: string; label: string; intent_type: 'dialogue' | 'skill_check' | 'combat' | 'trade' | 'quest'; prefill_text: string }> = [];

          // If the raw text looks like JSON, extract the narrative field
          if (rawText) {
            const trimmed = rawText.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('```json') || trimmed.startsWith('```')) {
              try {
                const cleaned = trimmed
                  .replace(/^```(?:json)?\s*/i, '')
                  .replace(/```\s*$/, '')
                  .trim();
                const parsed = JSON.parse(cleaned);
                // Try common field names for narrative
                narrative =
                  parsed.npc_response ||
                  parsed.narrative_pre_roll ||
                  parsed.pre_roll_narrative ||
                  parsed.narrative_result ||
                  parsed.narrative ||
                  parsed.response ||
                  '';
                // Try common field names for chips
                const rawChips = parsed.suggested_chips || parsed.suggestion_chips || parsed.chips;
                if (Array.isArray(rawChips)) {
                  chips = rawChips.slice(0, 4).map((c: unknown, i: number) => {
                    const obj = c as Record<string, unknown>;
                    if (typeof c === 'string') {
                      return { id: `chip${i}`, label: c, intent_type: 'dialogue' as const, prefill_text: c };
                    }
                    return {
                      id: (obj.id as string) || `chip${i}`,
                      label: (obj.label as string) || String(c),
                      intent_type: ((obj.intent_type as 'dialogue') || 'dialogue'),
                      prefill_text: (obj.prefill_text as string) || (obj.label as string) || String(c),
                    };
                  });
                }
              } catch {
                // Not valid JSON — use raw text as-is
              }
            }
          }

          // If we can't extract a meaningful narrative, throw — never fake a response
          if (!narrative) {
            throw new Error('LLM returned structured output that failed validation and contained no narrative');
          }

          return {
            requires_roll: false,
            check_type: undefined,
            difficulty_class: undefined,
            modifier_source: undefined,
            npc_response: narrative,
            suggested_chips: chips,
          };
        } catch (error) {
          // Propagate the real error — never fake a response
          throw error;
        }
      }

      // ── Mock AI path ───────────────────────────────────────────
      // Simulate AI processing delay
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
      return {
        requires_roll: false,
        check_type: undefined,
        difficulty_class: undefined,
        modifier_source: undefined,
        npc_response: '*Elder Thrain strokes his beard thoughtfully.*\n"Ah, an interesting question indeed. The village has seen many travelers, but few with such curiosity."',
        suggested_chips: [
          { id: 'talk', label: 'Ask about the ward', intent_type: 'dialogue' as const, prefill_text: 'Tell me about the village ward.' },
          { id: 'quest', label: 'Offer to help', intent_type: 'quest' as const, prefill_text: 'Is there anything I can help with?' },
        ],
      };
    },
    resolveRoll: async () => {
      // Simulate AI processing delay
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));
      return {
        narrative_result: '*Elder Thrain nods slowly.*\n"The dice have spoken. Fate has a way of guiding us, does it not?"',
        state_deltas: [],
        suggested_chips: [],
      };
    },
    useFreeTextFirst: true,
  },
  onStartCombat: () => {
    goBack();
  },
  initialDiceOutcome: 'random',
  initialUseMockAi: true,
  initialNpcPreset: 'sage',
  initialInteractionMode: 'freeTextFirst',
});

// ── Devtool state ───────────────────────────────────────────────────
let devToolsOpen = $state(true);
</script>

<svelte:head>
  <title>Dialogue Action Menu (C-162) — Aikami Dev</title>
</svelte:head>

<div class="fixed inset-0 bg-black">
  <!-- Dialogue Overlay (full-screen) -->
  <DialogueOverlay {viewModel} />

  <!-- DevTools Panel — top-right overlay -->
  {#if devToolsOpen}
    <div
      class="pointer-events-auto fixed right-0 top-0 z-50 flex h-full w-80 flex-col gap-3 overflow-y-auto bg-base-300/95 p-4 pt-2 shadow-2xl backdrop-blur-sm"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-base-content/10 pb-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-primary">🛠️ DevTools</span>
          <span class="badge badge-xs badge-accent">C-162</span>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-base-content/60"
          onclick={() => (devToolsOpen = false)}
        >
          ✕
        </button>
      </div>

      <!-- Dice Outcome -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🎲 Dice Outcome</span
        >
        <div class="join join-vertical">
          {#each (['random', 'always_succeed', 'always_fail'] as const) as outcome}
            <button
              type="button"
              class="btn btn-xs join-item {viewModel.diceOutcome === outcome
                ? 'btn-active btn-success'
                : 'btn-ghost'}"
              onclick={() => viewModel.setDiceOutcome(outcome as DiceOutcome)}
            >
              {outcome === 'random'
                ? '🎰 Random'
                : outcome === 'always_succeed'
                  ? '✅ Always Succeed'
                  : '❌ Always Fail'}
            </button>
          {/each}
        </div>
      </div>

      <!-- AI Mode -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🤖 AI Mode</span
        >
        <div class="join">
          <button
            type="button"
            class="btn btn-xs join-item {viewModel.useMockAi ? 'btn-active btn-warning' : 'btn-ghost'}"
            onclick={() => viewModel.setUseMockAi(true)}
          >
            🎭 Mock AI
          </button>
          <button
            type="button"
            class="btn btn-xs join-item {!viewModel.useMockAi ? 'btn-active btn-info' : 'btn-ghost'}"
            onclick={() => viewModel.setUseMockAi(false)}
          >
            🌐 Real LLM
          </button>
        </div>
        {#if viewModel.useMockAi}
          <span class="text-xs text-base-content/40 italic"
            >Pre-written narratives, 800ms simulated latency</span
          >
        {:else}
          <span class="text-xs text-warning/70 italic"
            >⚠️ Requires configured text provider (OpenRouter API key)</span
          >
        {/if}
      </div>

      <!-- NPC Persona -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >👤 NPC Persona</span
        >
        <div class="flex flex-wrap gap-1">
          {#each (['sage', 'guard', 'innkeeper', 'blacksmith', 'bandit', 'merchant'] as const) as preset}
            <button
              type="button"
              class="btn btn-xs {viewModel.mockNpcPreset === preset
                ? 'btn-active btn-primary'
                : 'btn-outline'}"
              onclick={() => viewModel.setMockNpcPreset(preset as DevNpcPreset)}
            >
              {preset === 'sage'
                ? '🧙 Sage'
                : preset === 'guard'
                  ? '🛡️ Guard'
                  : preset === 'innkeeper'
                    ? '🍺 Innkeeper'
                    : preset === 'blacksmith'
                      ? '⚒️ Smith'
                      : preset === 'bandit'
                        ? '🗡️ Bandit'
                        : '💰 Merchant'}
            </button>
          {/each}
        </div>
      </div>

      <!-- Interaction Mode -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >📋 Interaction Mode</span
        >
        <div class="flex flex-wrap gap-1">
          <button
            type="button"
            class="btn btn-xs {viewModel.interactionMode === 'freeTextFirst'
              ? 'btn-active btn-primary'
              : 'btn-outline'}"
            onclick={() => viewModel.setInteractionMode('freeTextFirst' as DevInteractionMode)}
          >
            💬 Free-Text-First (C-371)
          </button>
          <button
            type="button"
            class="btn btn-xs {viewModel.interactionMode === 'menu'
              ? 'btn-active btn-secondary'
              : 'btn-outline'}"
            onclick={() => viewModel.setInteractionMode('menu' as DevInteractionMode)}
          >
            📜 Action Menu
          </button>
          <button
            type="button"
            class="btn btn-xs {viewModel.interactionMode === 'freeform'
              ? 'btn-active btn-accent'
              : 'btn-outline'}"
            onclick={() => viewModel.setInteractionMode('freeform' as DevInteractionMode)}
          >
            ✏️ Legacy Freeform
          </button>
        </div>
        <span class="text-xs text-base-content/40 italic">
          {viewModel.interactionMode === 'freeTextFirst'
            ? 'C-371 two-call pipeline: free-text → chips → dice'
            : viewModel.interactionMode === 'menu'
              ? 'C-162 BG3-style buttons'
              : 'Legacy text input (C-128/C-157)'}
        </span>
      </div>

      <!-- Auto Image Generation -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🖼️ Image Gen</span
        >
        <div class="join">
          <button
            type="button"
            class="btn btn-xs join-item {viewModel.autoGenerateImage ? 'btn-active btn-success' : 'btn-ghost'}"
            onclick={() => viewModel.setAutoGenerateImage(true)}
          >
            🤖 Auto
          </button>
          <button
            type="button"
            class="btn btn-xs join-item {!viewModel.autoGenerateImage ? 'btn-active btn-ghost' : 'btn-ghost'}"
            onclick={() => viewModel.setAutoGenerateImage(false)}
          >
            ✋ Manual
          </button>
        </div>
        {#if viewModel.autoGenerateImage}
          <span class="text-xs text-base-content/40 italic"
            >Generates scene image on each skill check resolution</span
          >
        {/if}
      </div>

      <!-- Quick Actions -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >⚡ Quick Actions</span
        >
        <div class="flex flex-col gap-1">
          <!-- Force Dice Roll -->
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
            >🎲 Dice Roll Test</span
          >
          <button
            type="button"
            class="btn btn-xs btn-accent btn-outline"
            onclick={() =>
              viewModel.forceDiceRoll({
                checkType: 'Persuasion',
                difficultyClass: 12,
                statModifier: 'CHA',
                statModifierValue: 2,
              })}
          >
            🎲 Force Dice Roll (DC 12, CHA +2)
          </button>
        </div>

        <!-- Generate Scene Image -->
          <button
            type="button"
            class="btn btn-xs btn-accent btn-outline"
            onclick={() => viewModel.generateSceneImage()}
          >
            🖼️ Generate Scene Image
          </button>
          <!-- End Chat -->
          <button
            type="button"
            class="btn btn-xs btn-error btn-outline"
            onclick={() => viewModel.endChat()}
          >
            🚪 End Chat
          </button>
          <!-- Reset (re-create the VM) -->
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            onclick={() => {
              viewModel.setMockNpcPreset('sage');
              viewModel.setDiceOutcome('random');
              viewModel.setUseMockAi(true);
              viewModel.setInteractionMode('freeTextFirst' as DevInteractionMode);
            }}
          >
            🔄 Reset All
          </button>
        </div>
      </div>

      <!-- Expression (NPC avatar control) -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >😊 Expression</span
        >
        <div class="flex flex-wrap gap-1">
          {#each viewModel.availableExpressions as expression}
            <button
              type="button"
              class="btn btn-xs {viewModel.npcExpression === expression
                ? 'btn-active btn-accent'
                : 'btn-outline'}"
              onclick={() => viewModel.setNpcExpression(expression)}
            >
              {expression}
            </button>
          {/each}
        </div>
        <span class="text-xs text-base-content/40 italic">NPC: {viewModel.npcExpression}</span>
      </div>

      <!-- State Inspector -->
      <div class="flex flex-col gap-1.5 border-t border-base-content/10 pt-3">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🔍 Inspector</span
        >
        <div class="flex flex-col gap-1 text-xs font-mono text-base-content/60">
          <span>Phase: <strong class="text-primary">{viewModel.dialoguePhase}</strong></span>
          <span
            >Dice:
            <strong class="text-accent">{viewModel.skillCheckState?.phase ?? 'none'}</strong></span
          >
          <span>Streaming: <strong>{viewModel.isStreaming ? 'yes' : 'no'}</strong></span>
          <span>Resolving: <strong>{viewModel.isResolvingSkillCheck ? 'yes' : 'no'}</strong></span>
          {#if viewModel.generatedImages.some((img) => img.status === 'done')}
            <span class="text-success">Images:</span>
            {#each viewModel.generatedImages.filter((img) => img.status === 'done' && img.url) as image (image.id)}
              <a
                href={image.url}
                target="_blank"
                class="text-xs text-info underline truncate"
                rel="noreferrer"
                >{image.url}</a
              >
            {/each}
          {/if}
          {#if viewModel.streamError}
            <span class="text-error">Error: {viewModel.streamError}</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- DevTools toggle button (when panel is closed) -->
  {#if !devToolsOpen}
    <button
      type="button"
      class="pointer-events-auto fixed right-2 top-2 z-50 btn btn-xs btn-ghost"
      onclick={() => (devToolsOpen = true)}
    >
      🛠️ DevTools
    </button>
  {/if}
</div>

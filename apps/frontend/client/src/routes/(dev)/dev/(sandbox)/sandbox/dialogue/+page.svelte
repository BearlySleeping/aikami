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

import { NpcIntentAnalysisOutputSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { browser } from '$app/environment';
import {
  buildIntentAnalysisSystemPrompt,
  recoverIntentAnalysisOutput,
} from '$lib/services/game/npc_dialogue_service.svelte.ts';
import DialogueOverlay from '$lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte';
import {
  type DevInteractionMode,
  type DevNpcPreset,
  DialogueDevViewModel,
  type DialogueDevViewModelInterface,
  type DiceOutcome,
} from '$lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.dev.svelte.ts';
import { aiGatewayService } from '$services';

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

// ── C-401 streaming mock state ──────────────────────────────────────────

/** Turn state owned by the dev mock — mirrors the real service's turnState. */
let mockTurnState: {
  kind: 'idle' | 'streaming' | 'awaiting_envelope' | 'complete' | 'failed';
  text?: string;
  reason?: 'timeout' | 'aborted' | 'provider_error' | 'malformed';
  fallbackOffered?: boolean;
} = { kind: 'idle' };

/**
 * When true (via `?stall=1`), the mock never streams — simulates a stalled
 * provider for the AC-4 timeout E2E.
 */
const STALL_MODE = typeof window !== 'undefined' && window.location.search.includes('stall=1');

/**
 * C-417 AC-4: when `?manyChips=1`, the mock returns more suggestion chips
 * than fit a 1280×720 viewport so the E2E spec can assert the chip row
 * wraps instead of hiding chips behind a horizontal scrollbar.
 */
const MANY_CHIPS_MODE =
  typeof window !== 'undefined' && window.location.search.includes('manyChips=1');

/**
 * Emits chunks to onChunk on a fixed cadence, respecting the abort signal.
 * Resolves after the last chunk; rejects with AbortError on cancel (AC-3).
 */
const emitChunks = (options: {
  chunks: string[];
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  intervalMs?: number;
}): Promise<void> => {
  const { chunks, onChunk, signal, intervalMs = 110 } = options;
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let index = 0;
    const timer = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(timer);
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      if (index < chunks.length) {
        onChunk?.(chunks[index]);
        mockTurnState = { kind: 'streaming', text: chunks.slice(0, index + 1).join('') };
        index++;
      } else {
        clearInterval(timer);
        resolve();
      }
    }, intervalMs);
  });
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
    generateTurn: async (opts: { onChunk?: (text: string) => void; signal?: AbortSignal }) => {
      // C-401: stream a deterministic slow narrative, then return the turn.
      const chunks = ['*The elder ponders your words.*\n', '"An interesting proposition."'];
      await emitChunks({ chunks, onChunk: opts.onChunk, signal: opts.signal });
      mockTurnState = { kind: 'complete', text: chunks.join('') };
      return {
        narrative: chunks.join(''),
        choices: [
          { id: 'talk', label: 'Ask about the ward' },
          { id: 'leave', label: 'Leave' },
        ],
        source: 'ai',
      };
    },
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
    /** Turn state owned by the dev mock (C-401) — mirrors the real service. */
    get turnState() {
      return mockTurnState;
    },
    analyzeIntent: async (opts: {
      npcId: string;
      npcName: string;
      messages: Array<{ role: 'player' | 'npc'; content: string }>;
      signal: AbortSignal;
      gameStateFacts?: string[];
      playerContext?: { characterSheetSummary: string; level: number; classId: string };
      onChunk?: (text: string) => void;
    }) => {
      if (!viewModel.useMockAi) {
        // ── Real LLM path ────────────────────────────────────────
        const playerMsg = opts.messages.filter((m) => m.role === 'player').pop();
        const input = {
          playerInput: playerMsg?.content ?? '',
          npcContext: {
            name: opts.npcName,
            persona: `You are ${opts.npcName}, a character in a fantasy world.`,
            allowedCommands: ['trade', 'offerQuest', 'skillCheck', 'giveItem'],
          },
          playerContext: opts.playerContext ?? {
            characterSheetSummary: 'Level 1 Fighter',
            level: 1,
            classId: 'fighter',
          },
          recentHistory: opts.messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content.slice(0, 200),
          })),
          gameStateFacts: opts.gameStateFacts ?? [],
        };

        const systemPrompt = buildIntentAnalysisSystemPrompt();
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

        // Structured output failed — try to salvage narrative using shared helper
        const recovered = recoverIntentAnalysisOutput(
          result.text?.trim(),
          NpcIntentAnalysisOutputSchema,
        );

        return {
          requiresRoll: false,
          checkType: undefined,
          difficultyClass: undefined,
          modifierSource: undefined,
          npcResponse: recovered.npcResponse,
          suggestedChips: recovered.suggestedChips,
        };
      }

      // ── Mock AI path (C-401: streams via onChunk) ───────────────────
      if (STALL_MODE) {
        // Simulate a provider that never responds (AC-4): the ViewModel's
        // turnState check surfaces the actionable timeout error.
        await new Promise((resolve) => setTimeout(resolve, 1600));
        mockTurnState = { kind: 'failed', reason: 'timeout', fallbackOffered: true };
        return {
          requiresRoll: false,
          checkType: undefined,
          difficultyClass: undefined,
          modifierSource: undefined,
          npcResponse: '*Elder Thrain looks at you, waiting.*',
          suggestedChips: [],
        };
      }

      const narrativeChunks = [
        '*Elder Thrain strokes his beard thoughtfully.*\n',
        '"Ah, an interesting question indeed. ',
        'The village has seen many travelers, ',
        'but few with such curiosity."',
      ];
      await emitChunks({
        chunks: narrativeChunks,
        onChunk: opts.onChunk,
        signal: opts.signal,
      });
      mockTurnState = { kind: 'complete', text: narrativeChunks.join('') };

      const playerText = opts.messages.filter((m) => m.role === 'player').pop()?.content ?? '';
      let checkType: string | undefined;
      if (/persuade/i.test(playerText)) {
        checkType = 'Persuasion';
      } else if (/intimidate/i.test(playerText)) {
        checkType = 'Intimidation';
      }
      const requiresRoll = checkType !== undefined;

      // C-417 AC-4: produce a chip overflow deterministically.
      const suggestedChips = MANY_CHIPS_MODE
        ? [
            {
              id: 'talk',
              label: 'Ask about the ward',
              intentType: 'dialogue' as const,
              prefillText: 'Tell me about the village ward.',
            },
            {
              id: 'quest',
              label: 'Offer to help',
              intentType: 'quest' as const,
              prefillText: 'Is there anything I can help with?',
            },
            {
              id: 'trade',
              label: 'Browse the wares',
              intentType: 'trade' as const,
              prefillText: 'I would like to see your wares.',
            },
            {
              id: 'skill_persuade',
              label: 'Persuade the elder',
              intentType: 'skill_check' as const,
              prefillText: 'Let me try to convince you.',
            },
            {
              id: 'skill_intimidate',
              label: 'Intimidate the elder',
              intentType: 'skill_check' as const,
              prefillText: 'You will do as I say.',
            },
            {
              id: 'combat',
              label: 'Attack the elder',
              intentType: 'combat' as const,
              prefillText: 'Enough talk — draw your weapon.',
            },
            {
              id: 'leave',
              label: 'Turn back',
              intentType: 'dialogue' as const,
              prefillText: 'This is not worth my time.',
            },
            {
              id: 'news',
              label: 'Ask for news',
              intentType: 'dialogue' as const,
              prefillText: 'What news do you have?',
            },
          ]
        : [
            {
              id: 'talk',
              label: 'Ask about the ward',
              intentType: 'dialogue' as const,
              prefillText: 'Tell me about the village ward.',
            },
            {
              id: 'quest',
              label: 'Offer to help',
              intentType: 'quest' as const,
              prefillText: 'Is there anything I can help with?',
            },
          ];

      return {
        requiresRoll,
        checkType,
        difficultyClass: requiresRoll ? 12 : undefined,
        modifierSource: requiresRoll ? 'CHA' : undefined,
        npcResponse: narrativeChunks.join(''),
        suggestedChips,
      };
    },
    resolveRoll: async (opts: { onChunk?: (text: string) => void; signal?: AbortSignal }) => {
      // C-401: stream the resolution narrative (AC-2).
      // Note: no STALL_MODE branch here — in stall mode analyzeIntent returns
      // requiresRoll:false, so resolveRoll is never called (the AC-4 timeout
      // path is exercised through analyzeIntent).
      const narrativeChunks = [
        '*Elder Thrain nods slowly.*\n',
        '"The dice have spoken. Fate has a way of guiding us, ',
        'does it not?"',
      ];
      await emitChunks({
        chunks: narrativeChunks,
        onChunk: opts.onChunk,
        signal: opts.signal,
      });
      mockTurnState = { kind: 'complete', text: narrativeChunks.join('') };
      return {
        narrativeResult: narrativeChunks.join(''),
        stateDeltas: [],
        suggestedChips: [],
      };
    },
    useFreeTextFirst: true,
  },
  onStartCombat: () => {
    goBack();
  },
  initialDiceOutcome: 'always_succeed',
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
          data-testid="devtools-close"
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

      <!-- GM Mode Toggle — break the fourth wall -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🎭 GM Mode</span
        >
        <div class="join">
          <button
            type="button"
            class="btn btn-xs join-item"
            class:btn-active={viewModel.addressMode === 'scene'}
            class:btn-success={viewModel.addressMode === 'scene'}
            onclick={() => viewModel.setAddressMode('scene')}
          >
            🎮 Scene
          </button>
          <button
            type="button"
            class="btn btn-xs join-item"
            class:btn-active={viewModel.addressMode === 'gm'}
            class:btn-warning={viewModel.addressMode === 'gm'}
            onclick={() => viewModel.setAddressMode('gm')}
          >
            🧙 GM
          </button>
        </div>
        <span class="text-xs text-base-content/40 italic">
          {viewModel.addressMode === 'gm' ? 'Messages go to the Game Master (fourth wall)' : 'Messages go to the scene (NPC dialogue)'}
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

      <!-- Party UI Toggle -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >👥 Party</span
        >
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            class="toggle toggle-sm toggle-info"
            checked={viewModel.showPartyUi}
            onchange={() => viewModel.togglePartyUi()}
          >
          <span class="text-xs text-base-content/60">{viewModel.showPartyUi ? 'On' : 'Off'}</span>
        </div>
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

          <!-- Party Chime In (when party mode is on) -->
          {#if viewModel.showPartyUi}
            <button
              type="button"
              class="btn btn-xs btn-info btn-outline"
              onclick={() => viewModel.simulatePartyMessage()}
            >
              💬 Companion Chimes In
            </button>
          {/if}

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

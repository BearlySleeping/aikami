// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_sandbox_contract.ts
//
// Public contract for the Obsidian Chronicle sandbox ViewModel. Kept separate
// from the implementation so components and tests depend on the interface, not
// the class module — and so the implementation stays within file-size limits.

import type { BaseViewModelInterface, BaseViewModelOptions } from '@aikami/frontend/services/base';
import type {
  ObsidianActor,
  ObsidianCheck,
  ObsidianCheckDisplay,
  ObsidianCodexSection,
  ObsidianCombatAction,
  ObsidianCompactSurface,
  ObsidianComparisonRow,
  ObsidianEncounterSummary,
  ObsidianEquippedRow,
  ObsidianGalleryItem,
  ObsidianHistoryFilter,
  ObsidianInitiativeEntry,
  ObsidianIntentMode,
  ObsidianItem,
  ObsidianNavItem,
  ObsidianNote,
  ObsidianPartyRow,
  ObsidianPresentationMode,
  ObsidianQuest,
  ObsidianRecipient,
  ObsidianRecipientOption,
  ObsidianScene,
  ObsidianSuggestion,
  ObsidianSummary,
  ObsidianTextScale,
  ObsidianTimelineEntry,
  ObsidianViewport,
  ObsidianWorldEntry,
} from './obsidian_types';

/** Speech-bubble variants emitted by the sandbox. */
export type ObsidianSpeechEntry = Extract<ObsidianTimelineEntry, { kind: 'speech' }>;

/** Public options for the sandbox — mirrors a production BaseViewModel shape. */
export type ObsidianSandboxViewModelOptions = BaseViewModelOptions & {
  /** Simulated per-chunk stream delay. Tests pass 0 for determinism. */
  streamDelayMs?: number;
  /** Roll animation duration in ms (collapsed when reduced motion is on). */
  rollAnimationMs?: number;
  /** Surface the probe opens on. Defaults to the active conversation. */
  initialMode?: ObsidianPresentationMode;
};

/** Full public surface consumed by the sandbox view. */
export type ObsidianSandboxViewModelInterface = BaseViewModelInterface & {
  // ── Shell state ──────────────────────────────────────────────────
  readonly scene: ObsidianScene;
  readonly presentationMode: ObsidianPresentationMode;
  readonly compactSurface: ObsidianCompactSurface;
  readonly viewport: ObsidianViewport;
  readonly textScale: ObsidianTextScale;
  readonly reducedMotion: boolean;
  readonly controlsOpen: boolean;
  readonly isCompact: boolean;
  readonly isCombat: boolean;
  readonly showScene: boolean;
  readonly showPartyRail: boolean;
  readonly showChronicle: boolean;
  readonly showCodex: boolean;
  readonly economy: {
    readonly action: number;
    readonly bonus: number;
    readonly reaction: number;
    readonly movement: number;
  };
  readonly objectiveExpanded: boolean;

  setPresentationMode(mode: ObsidianPresentationMode): void;
  setCompactSurface(surface: ObsidianCompactSurface): void;
  setViewport(viewport: ObsidianViewport): void;
  setTextScale(scale: ObsidianTextScale): void;
  toggleReducedMotion(): void;
  toggleObjective(): void;
  toggleControls(): void;
  resetLayout(): void;

  // ── Chronicle ────────────────────────────────────────────────────
  readonly timeline: readonly ObsidianTimelineEntry[];
  readonly visibleMessages: readonly ObsidianTimelineEntry[];
  readonly historyFilter: ObsidianHistoryFilter;
  setHistoryFilter(filter: ObsidianHistoryFilter): void;

  readonly recipient: ObsidianRecipient;
  readonly recipientLabel: string;
  readonly recipientOptions: readonly ObsidianRecipientOption[];
  readonly audienceLabel: string;
  setRecipient(recipient: ObsidianRecipient): void;

  readonly intentMode: ObsidianIntentMode;
  setIntentMode(mode: ObsidianIntentMode): void;

  readonly draft: string;
  setDraft(text: string): void;

  readonly isStreaming: boolean;
  readonly streamingText: string;
  readonly isSpeaking: boolean;
  readonly canSend: boolean;
  readonly canContinue: boolean;
  readonly canRetry: boolean;
  readonly canRephrase: boolean;
  readonly suggestions: readonly ObsidianSuggestion[];

  send(): Promise<void>;
  cancelStream(): void;
  continueNarration(): Promise<void>;
  retry(): Promise<void>;
  rephrase(): void;
  applySuggestion(suggestion: ObsidianSuggestion): void;
  toggleVoice(): void;
  simulateFailure(): void;

  // ── Inline checks ────────────────────────────────────────────────
  readonly activeCheck: ObsidianCheck | undefined;
  readonly skillCheckNote: string;
  checkDisplay(check: ObsidianCheck): ObsidianCheckDisplay;
  checkPhaseLabel(check: ObsidianCheck): string;
  requestPersuasionCheck(): void;
  rollActiveCheck(): Promise<void>;
  resolveActiveCheck(natural: number): void;
  setPredeterminedRoll(natural: number): void;

  // ── Codex / management ───────────────────────────────────────────
  readonly codexSection: ObsidianCodexSection;
  readonly navItems: readonly ObsidianNavItem[];
  signedValue(value: number): string;
  openCodex(section: ObsidianCodexSection): void;
  closeCodex(): void;
  setCodexSection(section: ObsidianCodexSection): void;
  focusConversation(): void;
  unfocusConversation(): void;

  // ── Actors ───────────────────────────────────────────────────────
  readonly actors: readonly ObsidianActor[];
  readonly activeActorId: string;
  readonly inspectedActorId: string;
  readonly inspectedActor: ObsidianActor | undefined;
  readonly partyRows: readonly ObsidianPartyRow[];
  selectActor(actorId: string): void;

  // ── Inventory ────────────────────────────────────────────────────
  readonly items: readonly ObsidianItem[];
  readonly selectedItemId: string | undefined;
  readonly selectedItem: ObsidianItem | undefined;
  readonly comparisonRows: readonly ObsidianComparisonRow[];
  readonly equippedRows: readonly ObsidianEquippedRow[];
  readonly isSelectedEquipped: boolean;
  readonly equipmentSummary: string;
  selectItem(itemId: string): void;
  equipSelected(): void;
  unequipSelected(): void;

  // ── Journal ──────────────────────────────────────────────────────
  readonly quests: readonly ObsidianQuest[];
  readonly notes: readonly ObsidianNote[];
  readonly summaries: readonly ObsidianSummary[];
  regenerateSummary(summaryId: string): void;

  // ── World ────────────────────────────────────────────────────────
  readonly worldEntries: readonly ObsidianWorldEntry[];
  readonly gallery: readonly ObsidianGalleryItem[];

  // ── Combat ───────────────────────────────────────────────────────
  readonly combatActive: boolean;
  readonly combatRound: number;
  readonly currentCombatActorId: string;
  readonly initiative: readonly ObsidianInitiativeEntry[];
  readonly availableCombatActions: readonly ObsidianCombatAction[];
  readonly explorationActions: readonly ObsidianCombatAction[];
  readonly encounterSummary: ObsidianEncounterSummary | undefined;
  readonly isPlayerTurn: boolean;
  startCombat(): void;
  useCombatAction(actionId: string): void;
  useExplorationAction(actionId: string): void;
  endTurn(): void;
  endCombat(): void;
  dismissEncounterSummary(): void;
};

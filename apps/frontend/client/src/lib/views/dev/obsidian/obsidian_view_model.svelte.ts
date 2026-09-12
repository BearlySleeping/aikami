// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_view_model.svelte.ts
//
// Fixture-driven ViewModel for the Obsidian Chronicle design sandbox
// (docs/design/game_ui_hud_overhaul.md, Phase 1): one Scene/Chronicle/Codex
// shell, scoped drafts, destination-stable filters, single-commit checks, a
// stale-operation guard, and rules-driven combat availability. No services.
// Public shape: ./obsidian_sandbox_contract.ts. Pure display math:
// ./obsidian_sandbox_projections.ts.

import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  OBSIDIAN_ATTACK_DAMAGE,
  OBSIDIAN_COMBAT_START_TEXT,
  OBSIDIAN_ENCOUNTER_SUMMARY,
  OBSIDIAN_ENEMY_ACTION_TEXT,
  OBSIDIAN_ENEMY_DAMAGE,
  OBSIDIAN_ENEMY_DAMAGE_TEXT,
  OBSIDIAN_INITIATIVE,
} from './obsidian_combat_fixtures';
import {
  OBSIDIAN_ACTIONS_COMBAT,
  OBSIDIAN_ACTIONS_EXPLORATION,
  OBSIDIAN_ACTORS,
  OBSIDIAN_ENEMY_ID,
  OBSIDIAN_GALLERY,
  OBSIDIAN_ITEMS,
  OBSIDIAN_NOTES,
  OBSIDIAN_NPC_ID,
  OBSIDIAN_PERSUASION_CHECK,
  OBSIDIAN_PLAYER_ID,
  OBSIDIAN_QUESTS,
  OBSIDIAN_REPHRASES,
  OBSIDIAN_SCENE,
  OBSIDIAN_SUMMARIES,
  OBSIDIAN_TIMELINE,
  OBSIDIAN_WORLD,
} from './obsidian_fixtures';
import type {
  ObsidianSandboxViewModelInterface as ContractInterface,
  ObsidianSandboxViewModelOptions as ContractOptions,
  ObsidianSpeechEntry,
} from './obsidian_sandbox_contract';
export type ObsidianSandboxViewModelInterface = ContractInterface;
export type ObsidianSandboxViewModelOptions = ContractOptions;

import {
  actorIdFor,
  advanceTurn,
  applyDamageToActor,
  applyDamageToInitiative,
  audienceLabelFor,
  buildAvailableCombatActions,
  buildCheckDisplay,
  buildComparisonRows,
  buildEquipmentSummary,
  buildEquippedRows,
  buildPartyRows,
  checkPhaseLabel,
  DEFAULT_ECONOMY,
  EMPTY_DRAFTS,
  filterTimeline,
  findCheck,
  isItemEquipped,
  markCurrentActor,
  NAV_ITEMS,
  RECIPIENT_OPTIONS,
  recipientLabelFor,
  replyFor,
  rollD20,
  SKILL_CHECK_NOTE,
  SUGGESTION_CHIPS,
  signed,
  speakerFor,
  wait,
} from './obsidian_sandbox_projections';

import type {
  ObsidianActor,
  ObsidianCheck,
  ObsidianCheckDisplay,
  ObsidianCodexSection,
  ObsidianCompactSurface,
  ObsidianEncounterSummary,
  ObsidianEquipSlot,
  ObsidianGalleryItem,
  ObsidianHistoryFilter,
  ObsidianInitiativeEntry,
  ObsidianIntentMode,
  ObsidianItem,
  ObsidianNote,
  ObsidianPresentationMode,
  ObsidianQuest,
  ObsidianRecipient,
  ObsidianScene,
  ObsidianSummary,
  ObsidianTextScale,
  ObsidianTimelineEntry,
  ObsidianViewport,
  ObsidianWorldEntry,
} from './obsidian_types';

/** Build with `createObsidianSandboxViewModel` (tests) or `getObsidianSandboxViewModel`. */
class ObsidianSandboxViewModel
  extends BaseViewModel<ObsidianSandboxViewModelOptions>
  implements ObsidianSandboxViewModelInterface
{
  // ── Shell ────────────────────────────────────────────────────────
  scene = $state<ObsidianScene>(OBSIDIAN_SCENE);
  presentationMode = $state<ObsidianPresentationMode>('dialogue');
  compactSurface = $state<ObsidianCompactSurface>('chronicle');
  viewport = $state<ObsidianViewport>('desktop');
  textScale = $state<ObsidianTextScale>('default');
  reducedMotion = $state(false);
  objectiveExpanded = $state(false);
  controlsOpen = $state(true);

  // ── Chronicle ────────────────────────────────────────────────────
  timeline = $state<ObsidianTimelineEntry[]>([...OBSIDIAN_TIMELINE]);
  historyFilter = $state<ObsidianHistoryFilter>('all');
  recipient = $state<ObsidianRecipient>('npc');
  intentMode = $state<ObsidianIntentMode>('say');
  draftsByRecipient = $state<Record<ObsidianRecipient, string>>({ ...EMPTY_DRAFTS });
  isStreaming = $state(false);
  streamingText = $state('');
  isSpeaking = $state(false);
  lastErrorId = $state<string | undefined>(undefined);

  // ── Inline checks ────────────────────────────────────────────────
  activeCheckId = $state<string | undefined>(undefined);

  // ── Codex ────────────────────────────────────────────────────────
  codexSection = $state<ObsidianCodexSection>('character');

  // ── Actors ───────────────────────────────────────────────────────
  actors = $state<ObsidianActor[]>([...OBSIDIAN_ACTORS]);
  activeActorId = $state(OBSIDIAN_PLAYER_ID);
  inspectedActorId = $state(OBSIDIAN_PLAYER_ID);

  // ── Inventory ────────────────────────────────────────────────────
  items = $state<ObsidianItem[]>([...OBSIDIAN_ITEMS]);
  selectedItemId = $state<string | undefined>('item-shortsword');
  equippedBySlot = $state<Record<ObsidianEquipSlot, string | undefined>>({
    mainHand: 'item-longsword',
    offHand: 'item-shortsword',
    armor: 'item-chainmail',
    trinket: 'item-warden-ward',
  });

  // ── Journal / world ──────────────────────────────────────────────
  quests = $state<ObsidianQuest[]>([...OBSIDIAN_QUESTS]);
  notes = $state<ObsidianNote[]>([...OBSIDIAN_NOTES]);
  summaries = $state<ObsidianSummary[]>([...OBSIDIAN_SUMMARIES]);
  worldEntries = $state<ObsidianWorldEntry[]>([...OBSIDIAN_WORLD]);
  gallery = $state<ObsidianGalleryItem[]>([...OBSIDIAN_GALLERY]);

  // ── Combat ───────────────────────────────────────────────────────
  combatActive = $state(false);
  combatRound = $state(1);
  currentCombatActorId = $state(OBSIDIAN_PLAYER_ID);
  economy = $state({ ...DEFAULT_ECONOMY });
  initiative = $state<ObsidianInitiativeEntry[]>([...OBSIDIAN_INITIATIVE]);
  encounterSummary = $state<ObsidianEncounterSummary | undefined>(undefined);

  // ── Internals (no reactivity required) ───────────────────────────
  private readonly _streamDelayMs: number;
  private readonly _rollAnimationMs: number;
  private _operationCounter = 0;
  private _activeOperationId: number | undefined;
  private _predeterminedRoll: number | undefined;
  private _returnMode: ObsidianPresentationMode = 'dialogue';

  constructor(options: ObsidianSandboxViewModelOptions) {
    super(options);
    this._streamDelayMs = options.streamDelayMs ?? 14;
    this._rollAnimationMs = options.rollAnimationMs ?? 900;
    if (options.initialMode) {
      this.presentationMode = options.initialMode;
    }
  }

  // Shell

  get isCompact(): boolean {
    return this.viewport === 'compact';
  }

  get isCombat(): boolean {
    return this.presentationMode === 'combat' && this.combatActive;
  }

  get showPartyRail(): boolean {
    return this.isCompact ? this.compactSurface === 'scene' : true;
  }

  get showScene(): boolean {
    if (this.isCompact) {
      return this.compactSurface === 'scene';
    }
    return this.presentationMode !== 'focus' && this.presentationMode !== 'management';
  }

  get showChronicle(): boolean {
    if (this.isCompact) {
      return this.compactSurface === 'chronicle';
    }
    return (
      this.presentationMode === 'dialogue' ||
      this.presentationMode === 'combat' ||
      this.presentationMode === 'focus'
    );
  }

  get showCodex(): boolean {
    return this.isCompact
      ? this.compactSurface === 'codex'
      : this.presentationMode === 'management';
  }

  setPresentationMode(mode: ObsidianPresentationMode): void {
    this.presentationMode = mode;
    if (mode === 'combat') {
      this.compactSurface = 'chronicle';
    }
  }

  setCompactSurface(surface: ObsidianCompactSurface): void {
    this.compactSurface = surface;
  }

  setViewport(viewport: ObsidianViewport): void {
    this.viewport = viewport;
  }

  setTextScale(scale: ObsidianTextScale): void {
    this.textScale = scale;
  }

  toggleReducedMotion(): void {
    this.reducedMotion = !this.reducedMotion;
  }

  toggleObjective(): void {
    this.objectiveExpanded = !this.objectiveExpanded;
  }

  toggleControls(): void {
    this.controlsOpen = !this.controlsOpen;
  }

  resetLayout(): void {
    this.viewport = 'desktop';
    this.textScale = 'default';
    this.compactSurface = 'chronicle';
    this.presentationMode = 'dialogue';
    this.objectiveExpanded = false;
  }

  // Chronicle

  get visibleMessages(): readonly ObsidianTimelineEntry[] {
    return filterTimeline(this.timeline, this.historyFilter);
  }

  setHistoryFilter(filter: ObsidianHistoryFilter): void {
    // Presentation-only. Never touches recipient or draft.
    this.historyFilter = filter;
  }

  get recipientLabel(): string {
    return recipientLabelFor(this.recipient);
  }

  get recipientOptions() {
    return RECIPIENT_OPTIONS;
  }

  get audienceLabel(): string {
    return audienceLabelFor(this.recipient);
  }

  setRecipient(recipient: ObsidianRecipient): void {
    // Switching recipients preserves every scoped draft and never sends.
    this.recipient = recipient;
  }

  setIntentMode(mode: ObsidianIntentMode): void {
    this.intentMode = mode;
  }

  get draft(): string {
    return this.draftsByRecipient[this.recipient];
  }

  setDraft(text: string): void {
    this.draftsByRecipient = { ...this.draftsByRecipient, [this.recipient]: text };
  }

  get canSend(): boolean {
    return this.draft.trim().length > 0 && !this.isStreaming;
  }

  get canContinue(): boolean {
    return !this.isStreaming;
  }

  get canRetry(): boolean {
    return this.lastErrorId !== undefined && !this.isStreaming;
  }

  get canRephrase(): boolean {
    if (this.isStreaming) {
      return false;
    }
    return this.timeline.some(
      (entry) => entry.kind === 'speech' && entry.actorId === OBSIDIAN_NPC_ID,
    );
  }

  get suggestions() {
    return SUGGESTION_CHIPS;
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.isStreaming) {
      return;
    }

    const recipient = this.recipient;
    const operationId = ++this._operationCounter;
    this._activeOperationId = operationId;
    this.draftsByRecipient = { ...this.draftsByRecipient, [recipient]: '' };

    if (this.intentMode === 'act') {
      this._append({ kind: 'action', id: `action-${operationId}`, actorName: 'Rook', text });
    } else {
      this._append({
        kind: 'speech',
        id: `speech-${operationId}`,
        speaker: 'Rook',
        actorId: OBSIDIAN_PLAYER_ID,
        recipient,
        text,
        altCount: 0,
        streaming: false,
      });
    }

    const replyText = replyFor(recipient);
    this.isStreaming = true;
    this.streamingText = '';

    const completed = await this._streamReply({ text: replyText, operationId });
    if (!completed) {
      return;
    }

    this._append({
      kind: 'speech',
      id: `speech-${operationId}-reply`,
      speaker: speakerFor(recipient),
      actorId: actorIdFor(recipient),
      recipient,
      text: replyText,
      altCount: 0,
      streaming: false,
    });
    this._finishStream(operationId);
  }

  cancelStream(): void {
    this._activeOperationId = undefined;
    this.isStreaming = false;
    this.streamingText = '';
  }

  async continueNarration(): Promise<void> {
    if (this.isStreaming) {
      return;
    }
    const operationId = ++this._operationCounter;
    this._activeOperationId = operationId;
    this.isStreaming = true;
    this.streamingText = '';
    const text = 'The rain thickens. Somewhere past the gate, a bell begins to toll.';
    const completed = await this._streamReply({ text, operationId });
    if (!completed) {
      return;
    }
    this._append({ kind: 'narration', id: `narration-${operationId}`, speaker: 'Chronicle', text });
    this._finishStream(operationId);
  }

  async retry(): Promise<void> {
    if (!this.lastErrorId || this.isStreaming) {
      return;
    }
    const failedId = this.lastErrorId;
    this.lastErrorId = undefined;
    this.timeline = this.timeline.filter((entry) => entry.id !== failedId);
    await this.continueNarration();
  }

  rephrase(): void {
    if (!this.canRephrase) {
      return;
    }
    const speechEntries = this.timeline.filter(
      (entry): entry is ObsidianSpeechEntry =>
        entry.kind === 'speech' && entry.actorId === OBSIDIAN_NPC_ID,
    );
    const last = speechEntries.at(-1);
    if (!last) {
      return;
    }
    const nextText = OBSIDIAN_REPHRASES[last.altCount % OBSIDIAN_REPHRASES.length];
    if (!nextText) {
      return;
    }
    // Presentation-only: the check result and any consequences are untouched.
    this.timeline = this.timeline.map((entry) =>
      entry.id === last.id ? { ...last, text: nextText, altCount: last.altCount + 1 } : entry,
    );
  }

  applySuggestion(suggestion: { prefill: string }): void {
    this.setDraft(suggestion.prefill);
  }

  toggleVoice(): void {
    this.isSpeaking = !this.isSpeaking;
  }

  simulateFailure(): void {
    const id = `error-${++this._operationCounter}`;
    this._append({
      kind: 'error',
      id,
      text: 'The chronicler lost the thread of that reply. Your draft is safe.',
      recoverable: true,
    });
    this.lastErrorId = id;
  }

  // Inline checks

  get activeCheck(): ObsidianCheck | undefined {
    return this.activeCheckId ? findCheck(this.timeline, this.activeCheckId) : undefined;
  }

  get skillCheckNote(): string {
    return SKILL_CHECK_NOTE;
  }

  checkDisplay(check: ObsidianCheck): ObsidianCheckDisplay {
    return buildCheckDisplay(check);
  }

  checkPhaseLabel(check: ObsidianCheck): string {
    return checkPhaseLabel(check);
  }

  requestPersuasionCheck(): void {
    const checkId = OBSIDIAN_PERSUASION_CHECK.id;
    if (this.activeCheckId === checkId || findCheck(this.timeline, checkId)) {
      return;
    }
    this._append({
      kind: 'check',
      id: `check-entry-${checkId}`,
      check: { ...OBSIDIAN_PERSUASION_CHECK },
    });
    this.activeCheckId = checkId;
    this.presentationMode = 'dialogue';
    if (this.isCompact) {
      this.compactSurface = 'chronicle';
    }
  }

  async rollActiveCheck(): Promise<void> {
    const check = this.activeCheck;
    if (check?.phase !== 'pending') {
      return;
    }
    this._updateCheck({ ...check, phase: 'rolling' });
    await wait(this.reducedMotion ? 0 : this._rollAnimationMs);
    const natural = this._predeterminedRoll ?? rollD20();
    this._predeterminedRoll = undefined;
    this.resolveActiveCheck(natural);
  }

  resolveActiveCheck(natural: number): void {
    const check = this.activeCheck;
    if (!check || check.committed) {
      return;
    }
    const modifier = check.abilityModifier + (check.proficient ? check.proficiencyBonus : 0);
    const total = natural + modifier;
    const isSuccess = total >= check.dc;
    this._updateCheck({ ...check, phase: 'resolved', natural, total, isSuccess, committed: true });
    this._append({
      kind: 'consequence',
      id: `consequence-${check.id}`,
      text: isSuccess ? check.stakes.success : check.stakes.failure,
      sourceId: check.id,
    });
    this.activeCheckId = undefined;
  }

  setPredeterminedRoll(natural: number): void {
    this._predeterminedRoll = natural;
  }

  // Codex / management

  get navItems() {
    return NAV_ITEMS;
  }

  signedValue(value: number): string {
    return signed(value);
  }

  openCodex(section: ObsidianCodexSection): void {
    if (this.presentationMode !== 'management') {
      this._returnMode = this.presentationMode;
    }
    this.codexSection = section;
    this.presentationMode = 'management';
    if (this.isCompact) {
      this.compactSurface = 'codex';
    }
  }

  closeCodex(): void {
    this.presentationMode = this._returnMode;
    if (this.isCompact) {
      this.compactSurface = 'scene';
    }
  }

  setCodexSection(section: ObsidianCodexSection): void {
    this.codexSection = section;
  }

  focusConversation(): void {
    this.presentationMode = 'focus';
  }

  unfocusConversation(): void {
    this.presentationMode = 'dialogue';
  }

  // Actors

  get inspectedActor(): ObsidianActor | undefined {
    return this.actors.find((actor) => actor.id === this.inspectedActorId);
  }

  get partyRows() {
    return buildPartyRows(this.actors, this.activeActorId);
  }

  selectActor(actorId: string): void {
    this.inspectedActorId = actorId;
    this.openCodex(actorId === OBSIDIAN_PLAYER_ID ? 'character' : 'party');
  }

  // Inventory

  get selectedItem(): ObsidianItem | undefined {
    return this.items.find((item) => item.id === this.selectedItemId);
  }

  get comparisonRows() {
    return buildComparisonRows(this.items, this.equippedBySlot, this.selectedItem);
  }

  get equippedRows() {
    return buildEquippedRows(this.items, this.equippedBySlot);
  }

  get isSelectedEquipped(): boolean {
    return isItemEquipped(this.selectedItem, this.equippedBySlot);
  }

  get equipmentSummary(): string {
    return buildEquipmentSummary(this.equippedRows);
  }

  selectItem(itemId: string): void {
    this.selectedItemId = itemId;
  }

  equipSelected(): void {
    const selected = this.selectedItem;
    if (!selected?.equippedSlot) {
      return;
    }
    this.equippedBySlot = { ...this.equippedBySlot, [selected.equippedSlot]: selected.id };
  }

  unequipSelected(): void {
    const selected = this.selectedItem;
    if (!selected?.equippedSlot) {
      return;
    }
    if (this.equippedBySlot[selected.equippedSlot] === selected.id) {
      this.equippedBySlot = { ...this.equippedBySlot, [selected.equippedSlot]: undefined };
    }
  }

  // Journal / world

  regenerateSummary(summaryId: string): void {
    // Regeneration is interpretation-only: history and world state untouched.
    this.summaries = this.summaries.map((summary) =>
      summary.id === summaryId ? { ...summary, stale: false } : summary,
    );
  }

  // Combat

  get isPlayerTurn(): boolean {
    return this.currentCombatActorId === OBSIDIAN_PLAYER_ID;
  }

  get explorationActions() {
    return OBSIDIAN_ACTIONS_EXPLORATION;
  }

  get availableCombatActions() {
    return buildAvailableCombatActions(OBSIDIAN_ACTIONS_COMBAT, this.economy);
  }

  startCombat(): void {
    if (this.combatActive) {
      return;
    }
    this.combatActive = true;
    this.presentationMode = 'combat';
    this.combatRound = 1;
    this.currentCombatActorId = OBSIDIAN_PLAYER_ID;
    this.economy = { ...DEFAULT_ECONOMY };
    this.initiative = this.initiative.map((entry) => ({
      ...entry,
      isCurrent: entry.actorId === OBSIDIAN_PLAYER_ID,
    }));
    this._append({
      kind: 'narration',
      id: `combat-start-${++this._operationCounter}`,
      speaker: 'Chronicle',
      text: OBSIDIAN_COMBAT_START_TEXT,
    });
  }

  useCombatAction(actionId: string): void {
    if (!this.combatActive || !this.isPlayerTurn) {
      return;
    }
    const action = this.availableCombatActions.find((candidate) => candidate.id === actionId);
    if (!action?.available) {
      return;
    }
    if (action.cost === 'action') {
      this.economy = { ...this.economy, action: 0 };
    }
    if (action.cost === 'bonus') {
      this.economy = { ...this.economy, bonus: 0 };
    }
    const operation = ++this._operationCounter;
    this._append({
      kind: 'action',
      id: `combat-action-${operation}`,
      actorName: 'Rook',
      text: action.targetLabel ? `${action.label} — ${action.targetLabel}.` : `${action.label}.`,
    });
    if (action.id === 'combat-attack') {
      const damage = OBSIDIAN_ATTACK_DAMAGE;
      this.initiative = applyDamageToInitiative(this.initiative, OBSIDIAN_ENEMY_ID, damage);
      this._append({
        kind: 'consequence',
        id: `combat-damage-${operation}`,
        text: `The longsword bites deep. Goblin Raider takes ${damage} damage.`,
      });
    } else {
      this._append({
        kind: 'consequence',
        id: `combat-effect-${operation}`,
        text: action.description,
      });
    }
  }

  useExplorationAction(actionId: string): void {
    const action = OBSIDIAN_ACTIONS_EXPLORATION.find((candidate) => candidate.id === actionId);
    if (!action) {
      return;
    }
    this._append({
      kind: 'action',
      id: `explore-${++this._operationCounter}`,
      actorName: 'Rook',
      text: action.label,
    });
  }

  endTurn(): void {
    if (!this.combatActive || !this.isPlayerTurn) {
      return;
    }
    const advance = advanceTurn(this.initiative, this.currentCombatActorId, this.combatRound);
    if (advance.enemyActs) {
      this._setCurrentCombatActor(OBSIDIAN_ENEMY_ID);
      this._enemyTurn();
      this.combatRound = advance.round + 1;
      this._setCurrentCombatActor(OBSIDIAN_PLAYER_ID);
      return;
    }
    this.combatRound = advance.round;
    this._setCurrentCombatActor(advance.currentActorId);
  }

  endCombat(): void {
    if (!this.combatActive) {
      return;
    }
    this.combatActive = false;
    this.presentationMode = 'dialogue';
    this.currentCombatActorId = OBSIDIAN_PLAYER_ID;
    this.initiative = this.initiative.map((entry) => ({
      ...entry,
      isCurrent: entry.actorId === OBSIDIAN_PLAYER_ID,
    }));
    this.encounterSummary = { ...OBSIDIAN_ENCOUNTER_SUMMARY };
  }

  dismissEncounterSummary(): void {
    this.encounterSummary = undefined;
  }

  private _append(entry: ObsidianTimelineEntry): void {
    this.timeline = [...this.timeline, entry];
  }

  private _updateCheck(next: ObsidianCheck): void {
    this.timeline = this.timeline.map((entry) =>
      entry.kind === 'check' && entry.check.id === next.id ? { ...entry, check: next } : entry,
    );
  }

  private async _streamReply(options: { text: string; operationId: number }): Promise<boolean> {
    const chunks = options.text.match(/[^.!?\n]+[.!?\n]*/g) ?? [options.text];
    let accumulated = '';
    for (const chunk of chunks) {
      await wait(this._streamDelayMs);
      if (this._activeOperationId !== options.operationId) {
        return false;
      }
      accumulated += chunk;
      this.streamingText = accumulated;
    }
    return true;
  }

  private _finishStream(operationId: number): void {
    if (this._activeOperationId !== operationId) {
      return;
    }
    this._activeOperationId = undefined;
    this.isStreaming = false;
    this.streamingText = '';
  }

  private _setCurrentCombatActor(actorId: string): void {
    this.currentCombatActorId = actorId;
    this.initiative = markCurrentActor(this.initiative, actorId);
    this.economy = { ...DEFAULT_ECONOMY };
  }

  private _enemyTurn(): void {
    const operation = ++this._operationCounter;
    this._append({
      kind: 'action',
      id: `enemy-action-${operation}`,
      actorName: 'Goblin Raider',
      text: OBSIDIAN_ENEMY_ACTION_TEXT,
    });
    this.actors = applyDamageToActor(this.actors, OBSIDIAN_PLAYER_ID, OBSIDIAN_ENEMY_DAMAGE);
    this.initiative = applyDamageToInitiative(
      this.initiative,
      OBSIDIAN_PLAYER_ID,
      OBSIDIAN_ENEMY_DAMAGE,
    );
    this._append({
      kind: 'consequence',
      id: `enemy-damage-${operation}`,
      text: OBSIDIAN_ENEMY_DAMAGE_TEXT,
    });
  }
}

/**
 * Testable factory — builds the ViewModel from typed options with no
 * production imports, so tests can pass fixtures and delay overrides.
 */
export const createObsidianSandboxViewModel = (
  options: ObsidianSandboxViewModelOptions,
): ObsidianSandboxViewModelInterface => ObsidianSandboxViewModel.create(options);

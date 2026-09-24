// apps/frontend/client/src/lib/views/game/ui/management_session.svelte.ts
//
// C-527 — the management host SESSION.
//
// The overlay-router ViewModel grew past its reviewed size ceiling by owning the
// whole management-host lifecycle, which is a separate responsibility: which
// section is showing, which sections have been visited, what the player came
// from, and where focus goes back. Splitting it here keeps the router a router.
//
// Ownership boundary: this module owns the SECTION ViewModels and the host's
// return context. It does NOT own the overlay stack — every open/close still
// goes through the router's own entry points (`openInventory`, `replaceOverlay`,
// …) so there is exactly one authority for what is on screen.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import { untrack } from 'svelte';
import type { NpcDialogueServiceInterface } from '$services';
import type { GameOverlayType } from '$types';
import type { getCharacterSheetViewModel } from '$views/game/dashboard/character_sheet_composition.ts';
import type { CharacterSheetViewModelInterface } from '$views/game/dashboard/character_sheet_view_model.svelte';
import type { getInventoryViewModel } from '$views/inventory/inventory_composition.ts';
import type { InventoryViewModelInterface } from '$views/inventory/inventory_view_model.svelte';
import type { getJournalViewModel } from '$views/journal/journal_composition.ts';
import type {
  JournalTab,
  JournalViewModelInterface,
} from '$views/journal/journal_view_model.svelte';
import type { getWorldViewModel } from '$views/world/world_composition.ts';
import type { WorldTab, WorldViewModelInterface } from '$views/world/world_view_model.svelte';
import type { GameUIOverlayCapabilities } from './game_ui_view_model_types.ts';
import {
  DEFAULT_MENU_LOCATION,
  isManagementOverlay,
  MANAGEMENT_SECTIONS,
  type ManagementLocation,
  type ManagementSectionId,
  managementLocationFromOverlay,
  managementOverlayFor,
  managementSectionLabel,
  normalizeManagementLocation,
} from './management_sections.ts';
import type { getPartyRosterViewModel } from './overlays/party_roster/party_roster_composition.ts';
import type { PartyRosterViewModelInterface } from './overlays/party_roster/party_roster_view_model.svelte';
import type { getReputationViewModel } from './overlays/reputation/reputation_composition.ts';
import type { ReputationViewModelInterface } from './overlays/reputation/reputation_view_model.svelte';

/**
 * Section subview → the owning feature view's OWN tab id.
 *
 * The management registry speaks navigation (a section plus a canonical
 * subview); the feature views speak their own tab vocabulary. `world` lands on
 * the World view's real default tab, because 'codex' names the section's
 * content, not one of `WorldTab` — feeding it straight to `setActiveTab` would
 * put the view in an invalid tab and throw on the next read.
 *
 * A subview with no entry here leaves the view on its own default.
 */
const JOURNAL_TAB_BY_SUBVIEW: Readonly<Record<string, JournalTab>> = {
  quests: 'quests',
  notes: 'notes',
  recaps: 'recaps',
};

const WORLD_TAB_BY_SUBVIEW: Readonly<Record<string, WorldTab>> = {
  codex: 'people',
};

/**
 * C-527 AC-2 — the captured origin of a management session.
 *
 * Directive 3: the host must be able to return the player to exactly where they
 * came from. The overlay stack already preserves the originating overlay and its
 * focus element; this type carries the parts the stack does not own.
 */
export type ManagementReturnContext = {
  /** Overlay that was active when the host opened (`NONE` = plain exploration). */
  originOverlay: GameOverlayType;
  /** NPC of the conversation the host was opened over, when there was one. */
  npcId?: string;
  /** Identity of the unsent composer draft, so it stays on the same actor. */
  draftId?: string;
  /** Scroll anchor of the originating surface, in CSS pixels. */
  scrollAnchor?: number;
};

export type ManagementPanelId =
  | 'inventory'
  | 'character'
  | 'journal'
  | 'party'
  | 'reputation'
  | 'world';

export type GameManagementSessionOptions = BaseFrontendClassOptions & {
  /** The router: the single authority for what is open. */
  overlays: GameUIOverlayCapabilities;
  /** Conversation identity, captured into the return context. */
  npcDialogue: NpcDialogueServiceInterface;

  // ── Section ViewModel factories (production wiring lives in the composition) ──

  createInventoryViewModel: typeof getInventoryViewModel;
  createJournalViewModel: typeof getJournalViewModel;
  createCharacterSheetViewModel: typeof getCharacterSheetViewModel;
  createPartyRosterViewModel: typeof getPartyRosterViewModel;
  createReputationViewModel: typeof getReputationViewModel;
  createWorldViewModel: typeof getWorldViewModel;
};

export type GameManagementSessionInterface = BaseFrontendClassInterface & {
  /** The active management location, derived from the overlay stack. */
  readonly location: ManagementLocation | undefined;
  /** Whether the current overlay is one of the management destinations. */
  readonly isOpen: boolean;
  /**
   * Whether a management session is live — from the captured origin until a
   * real exit. Distinct from {@link isOpen}; a session stays active while a
   * child/system surface is temporarily on top.
   */
  readonly isSessionActive: boolean;
  /** The last location opened through the host, used by the Menu entry. */
  readonly menuLocation: ManagementLocation;
  /** The captured origin of the current session, or undefined when none. */
  readonly returnContext: ManagementReturnContext | undefined;
  readonly sections: typeof MANAGEMENT_SECTIONS;
  readonly backLabel: string;
  /** Human label of the active section, for the workspace header. */
  readonly activeSectionLabel: string;

  readonly inventoryViewModel: InventoryViewModelInterface | undefined;
  readonly journalViewModel: JournalViewModelInterface | undefined;
  readonly dashboardViewModel: CharacterSheetViewModelInterface | undefined;
  readonly partyRosterViewModel: PartyRosterViewModelInterface | undefined;
  readonly reputationViewModel: ReputationViewModelInterface | undefined;
  readonly worldViewModel: WorldViewModelInterface | undefined;

  openSection(section: ManagementSectionId): void;
  openLocation(location: ManagementLocation): void;
  openMenu(): void;
  close(): void;

  /** Creates the active section's ViewModel once per session (idempotent). */
  ensureSection(overlay: GameOverlayType): void;
  /** Releases every section ViewModel and the session bookkeeping. */
  disposeSections(): void;
  /** Captures the origin if this is the session's first section. */
  beginSession(): void;
  /**
   * Central finalization for every close path (host Back, Escape, feature
   * close, backdrop, programmatic close, route teardown). Restores the scroll
   * anchor, drops the section ViewModels and clears the return context so a
   * stale origin can never be captured by the next session.
   */
  endSession(): void;
  /**
   * Edge trigger: true exactly once, on the open → closed transition, so focus
   * restoration happens after the DOM has re-rendered.
   */
  hostJustClosed(): boolean;
  /**
   * Schedules focus restoration on the next frame. A newer navigation cancels
   * a pending restoration so two closes cannot fight over focus.
   */
  scheduleFocusRestore(): void;
  /** Restores focus to the origin element, or the HUD Menu entry. */
  restoreFocus(): void;
  isSection(section: ManagementSectionId): boolean;
  isPanelActive(panel: ManagementPanelId): boolean;
  handleHostKeyDown(event: KeyboardEvent): void;
};

class GameManagementSession
  extends BaseFrontendClass<GameManagementSessionOptions>
  implements GameManagementSessionInterface
{
  private readonly _overlays: GameUIOverlayCapabilities;
  private readonly _npcDialogue: NpcDialogueServiceInterface;

  private readonly _createInventoryViewModel: typeof getInventoryViewModel;
  private readonly _createJournalViewModel: typeof getJournalViewModel;
  private readonly _createCharacterSheetViewModel: typeof getCharacterSheetViewModel;
  private readonly _createPartyRosterViewModel: typeof getPartyRosterViewModel;
  private readonly _createReputationViewModel: typeof getReputationViewModel;
  private readonly _createWorldViewModel: typeof getWorldViewModel;

  /**
   * Last subview remembered per section, so returning to a section lands where
   * the player left it. Transient UI state only — never persisted to a save.
   */
  private readonly _rememberedSubviews = new Map<ManagementSectionId, string>();

  /**
   * Sections whose ViewModel has been created for the current host session.
   * Deliberately NOT reactive: it is a creation guard, and a tracked read here
   * would re-run the lifecycle effect against itself.
   */
  private readonly _createdOverlays = new Set<GameOverlayType>();

  // ── Section ViewModels (one per visited section, alive for the session) ──

  inventoryViewModel = $state<InventoryViewModelInterface | undefined>(undefined);
  journalViewModel = $state<JournalViewModelInterface | undefined>(undefined);
  dashboardViewModel = $state<CharacterSheetViewModelInterface | undefined>(undefined);
  partyRosterViewModel = $state<PartyRosterViewModelInterface | undefined>(undefined);
  reputationViewModel = $state<ReputationViewModelInterface | undefined>(undefined);
  worldViewModel = $state<WorldViewModelInterface | undefined>(undefined);

  /** Last location the host opened — the HUD Menu entry resumes here. */
  menuLocation = $state<ManagementLocation>(DEFAULT_MENU_LOCATION);

  /** The captured origin of the current session. */
  returnContext = $state<ManagementReturnContext | undefined>(undefined);

  /** The element that held focus when the host opened. */
  private _originFocus: HTMLElement | undefined;

  /** Whether the host was open on the previous lifecycle tick. */
  private _hostWasOpen = false;

  /**
   * Cancels a pending focus restoration when navigation changes before the
   * scheduled frame runs — two closes must not fight over focus.
   */
  private _focusRestoreGeneration = 0;

  constructor(options: GameManagementSessionOptions) {
    super(options);
    this._overlays = options.overlays;
    this._npcDialogue = options.npcDialogue;
    this._createInventoryViewModel = options.createInventoryViewModel;
    this._createJournalViewModel = options.createJournalViewModel;
    this._createCharacterSheetViewModel = options.createCharacterSheetViewModel;
    this._createPartyRosterViewModel = options.createPartyRosterViewModel;
    this._createReputationViewModel = options.createReputationViewModel;
    this._createWorldViewModel = options.createWorldViewModel;
  }

  /**
   * @inheritdoc
   *
   * The active overlay is the authority for the SECTION, but several subviews
   * share one overlay (`notes`/`recaps` are both `JOURNAL`; `codex`/`reputation`
   * are not the same overlay but both land in `world`). The requested subview is
   * therefore remembered per section and merged back in here — but only when it
   * routes to the overlay that is actually active, so location and overlay can
   * never disagree about which feature view to build.
   */
  get location(): ManagementLocation | undefined {
    const base = managementLocationFromOverlay(this._overlays.activeOverlay);
    if (!base) {
      return undefined;
    }
    const remembered = this._rememberedSubviews.get(base.section);
    if (remembered === undefined) {
      return base;
    }
    const rememberedOverlay = managementOverlayFor({ section: base.section, subview: remembered });
    if (rememberedOverlay !== this._overlays.activeOverlay) {
      return base;
    }
    return normalizeManagementLocation({ section: base.section, subview: remembered });
  }

  /** @inheritdoc */
  get isOpen(): boolean {
    return isManagementOverlay(this._overlays.activeOverlay);
  }

  /** @inheritdoc */
  get isSessionActive(): boolean {
    return this.returnContext !== undefined;
  }

  get sections(): typeof MANAGEMENT_SECTIONS {
    return MANAGEMENT_SECTIONS;
  }

  get backLabel(): string {
    switch (this.returnContext?.originOverlay) {
      case 'DIALOGUE':
        return 'Back to conversation';
      case 'PAUSE_MENU':
        return 'Back to pause menu';
      default:
        return 'Back to game';
    }
  }

  get activeSectionLabel(): string {
    const section = this.location?.section;
    return section === undefined ? 'Menu' : managementSectionLabel(section);
  }

  isSection(section: ManagementSectionId): boolean {
    return this.location?.section === section;
  }

  isPanelActive(panel: ManagementPanelId): boolean {
    switch (panel) {
      case 'inventory':
      case 'character':
      case 'journal':
      case 'party':
        return this.isSection(panel);
      case 'reputation':
        return this.isSection('world') && this.location?.subview === 'reputation';
      case 'world':
        return this.isSection('world') && this.location?.subview !== 'reputation';
    }
  }

  /** Contains keyboard focus within the host's active, non-inert panel. */
  handleHostKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') {
      return;
    }
    const root = event.currentTarget;
    if (!(root instanceof HTMLElement) || root.querySelector('dialog[open]')) {
      return;
    }
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === root || !root.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (active === last || active === root)) {
      event.preventDefault();
      first.focus();
    }
  }

  /** @inheritdoc */
  openSection(section: ManagementSectionId): void {
    this.openLocation({ section });
  }

  /** @inheritdoc */
  openLocation(location: ManagementLocation): void {
    // Save the subview the player is actually looking at before switching, so
    // an in-view tab change (e.g. Journal notes → recaps) is remembered and a
    // later "open Journal" returns there instead of the default.
    this._captureActiveSubview();

    // No explicit subview means "wherever the player left this section", not
    // "reset to the default". The registry still validates the result, so a
    // stale shortcut degrades to the default instead of throwing.
    const requested = location.subview ?? this._rememberedSubviews.get(location.section);
    const normalized = normalizeManagementLocation({ ...location, subview: requested });
    if (!normalized) {
      this.debug('management:open:unknown-section', { section: location.section });
      return;
    }

    if (normalized.subview !== undefined) {
      this._rememberedSubviews.set(normalized.section, normalized.subview);
    }
    this.menuLocation = normalized;
    // Apply the subview to the feature ViewModel that already exists; a view
    // created later picks up the remembered subview from `ensureSection`.
    this._applyLocationToViewModels(normalized);

    const destination = managementOverlayFor(normalized);
    if (!destination) {
      return;
    }

    // Directive 3: opening a section REPLACES a sibling management section
    // rather than stacking one overlay per visited tab. `replaceOverlay` also
    // keeps the original pre-host focus and never resumes the engine, so
    // switching tabs cannot leak a simulation frame (Directive 6).
    if (isManagementOverlay(this._overlays.activeOverlay)) {
      if (this._overlays.activeOverlay === destination) {
        // Same overlay, different subview (notes ↔ recaps): the tab was just
        // applied; there is no overlay transition to perform.
        return;
      }
      this._overlays.replaceOverlay(destination);
      return;
    }

    // C-527 AC-2: capture the origin before the host takes over.
    this.beginSession();
    this._openOverlayDestination(destination);
  }

  /** @inheritdoc */
  openMenu(): void {
    this.openLocation(this.menuLocation);
  }

  /**
   * @inheritdoc
   *
   * Only closes the owning overlay. Finalization (return context, section
   * release, scroll restore) is centralized in {@link endSession}, which the
   * lifecycle effect runs when the active overlay actually leaves management —
   * so Back, Escape, a feature close button, a backdrop and a programmatic
   * close all end up in the same place.
   */
  close(): void {
    if (!this.isOpen) {
      return;
    }
    this._closeOverlayDestination(this._overlays.activeOverlay);
    // Finalize eagerly for callers without a live lifecycle effect (tests,
    // adapters). The lifecycle effect is the backstop for the other close
    // paths and is a no-op once the context is gone.
    this.endSession();
  }

  /** @inheritdoc */
  beginSession(): void {
    if (this.returnContext === undefined) {
      this._captureReturnContext();
      this._scheduleHostFocus();
    }
  }

  /** @inheritdoc */
  endSession(): void {
    const context = this.returnContext;
    this.returnContext = undefined;
    this.disposeSections();
    this._restoreReturnContext(context);
  }

  /** @inheritdoc */
  hostJustClosed(): boolean {
    if (this.isSessionActive) {
      this._hostWasOpen = true;
      return false;
    }
    if (!this._hostWasOpen) {
      return false;
    }
    this._hostWasOpen = false;
    return true;
  }

  /** @inheritdoc */
  scheduleFocusRestore(): void {
    const generation = ++this._focusRestoreGeneration;
    const restore = (): void => {
      if (generation !== this._focusRestoreGeneration) {
        return;
      }
      this.restoreFocus();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(restore);
    } else {
      restore();
    }
  }

  /** @inheritdoc */
  restoreFocus(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const origin = this._originFocus;
    this._originFocus = undefined;
    // Restore only to a destination that still exists and is actually
    // rendered. A disconnected or display:none origin (its panel was hidden)
    // falls back to the HUD Menu entry rather than focusing nothing.
    if (origin?.isConnected && origin.getClientRects().length > 0) {
      origin.focus();
      return;
    }
    document.querySelector<HTMLElement>('[data-testid="hud-menu-entry"]')?.focus();
  }

  /**
   * Records the subview the active feature ViewModel is currently showing.
   *
   * The Journal view owns its own tab state, so a click on its Quests/Notes/
   * Recaps tabs does not pass through the registry. Capturing the live tab here
   * keeps `_rememberedSubviews` truthful no matter how the subview was chosen.
   */
  private _captureActiveSubview(): void {
    const base = managementLocationFromOverlay(this._overlays.activeOverlay);
    if (!base) {
      return;
    }
    // Journal quests, notes and recaps all render through the canonical Journal
    // panel. Capture its live tab before a sibling switch, including when the
    // remembered/default location is the quests subview.
    if (base.section === 'journal' && this.journalViewModel) {
      this._rememberedSubviews.set('journal', this.journalViewModel.activeTab);
      return;
    }
    if (base.section === 'world' && base.subview === 'codex' && this.worldViewModel) {
      // The World view's own tabs (people/places/…) are not section subviews;
      // Codex is the section's content, reputation is the other overlay.
      this._rememberedSubviews.set('world', 'codex');
    }
  }

  /**
   * Pushes a location's subview into the feature ViewModel that already owns it.
   * A sibling switch keeps the Journal/World ViewModel alive, so notes ↔ recaps
   * (one overlay) can only change through this call.
   */
  private _applyLocationToViewModels(location: ManagementLocation): void {
    if (location.section === 'journal' && this.journalViewModel) {
      const tab = JOURNAL_TAB_BY_SUBVIEW[location.subview ?? ''];
      if (tab !== undefined) {
        untrack(() => this.journalViewModel?.setActiveTab(tab));
      }
    }
    if (location.section === 'world' && this.worldViewModel) {
      const tab = WORLD_TAB_BY_SUBVIEW[location.subview ?? ''];
      if (tab !== undefined) {
        untrack(() => this.worldViewModel?.setActiveTab(tab));
      }
    }
  }

  /** @inheritdoc */
  ensureSection(overlay: GameOverlayType): void {
    if (overlay === 'JOURNAL' || overlay === 'QUEST_LOG') {
      this._ensureJournalSection(overlay);
      return;
    }
    if (this._createdOverlays.has(overlay)) {
      return;
    }
    this._createdOverlays.add(overlay);

    switch (overlay) {
      case 'INVENTORY':
        this.inventoryViewModel = this._createInventoryViewModel({
          className: 'InventoryViewModel',
          presentation: 'management',
        });
        return;
      case 'CHARACTER_DASHBOARD':
        this.dashboardViewModel = this._createCharacterSheetViewModel({
          className: 'CharacterSheetViewModel',
          onClose: () => this._overlays.closeCharacterDashboard(),
        });
        return;
      case 'PARTY_ROSTER':
        this.partyRosterViewModel = this._createPartyRosterViewModel({
          className: 'PartyRosterViewModel',
          presentation: 'management',
        });
        return;
      case 'REPUTATION':
        this.reputationViewModel = this._createReputationViewModel({
          className: 'ReputationViewModel',
          presentation: 'management',
        });
        return;
      case 'WORLD': {
        const vm = this._createWorldViewModel({
          className: 'WorldViewModel',
          presentation: 'management',
        });
        this.worldViewModel = vm;
        // C-527: the World section's canonical subview is 'codex', which is the
        // section's name for the view — it is NOT one of the view's own tabs.
        const tab = this._rememberedTab('world', WORLD_TAB_BY_SUBVIEW);
        if (tab !== undefined) {
          untrack(() => vm.setActiveTab(tab as WorldTab));
        }
        return;
      }
      default:
        return;
    }
  }

  /** @inheritdoc */
  disposeSections(): void {
    this.inventoryViewModel = undefined;
    this.journalViewModel = undefined;
    this.dashboardViewModel = undefined;
    this.partyRosterViewModel = undefined;
    this.reputationViewModel = undefined;
    this.worldViewModel = undefined;
    this._createdOverlays.clear();
  }

  /** Creates or reuses the single ViewModel behind the two Journal aliases. */
  private _ensureJournalSection(overlay: 'JOURNAL' | 'QUEST_LOG'): void {
    const journal = this.journalViewModel;
    if (journal) {
      const tab =
        overlay === 'QUEST_LOG'
          ? 'quests'
          : (this._rememberedTab('journal', JOURNAL_TAB_BY_SUBVIEW) ?? 'quests');
      untrack(() => journal.setActiveTab(tab));
      return;
    }

    const vm = this._createJournalViewModel({ className: 'JournalViewModel' });
    this.journalViewModel = vm;
    this._createdOverlays.add('JOURNAL');
    this._createdOverlays.add('QUEST_LOG');
    // QUEST_LOG is a legacy input alias and always lands on the Journal's
    // default quests tab. The canonical JOURNAL overlay restores the tab the
    // player last used in this section.
    const tab =
      overlay === 'QUEST_LOG' ? undefined : this._rememberedTab('journal', JOURNAL_TAB_BY_SUBVIEW);
    if (tab !== undefined) {
      untrack(() => vm.setActiveTab(tab));
    }
  }

  /** The remembered own-tab for a section, translated through its map. */
  private _rememberedTab<T extends string>(
    section: ManagementSectionId,
    map: Readonly<Record<string, T>>,
  ): T | undefined {
    const subview = this._rememberedSubviews.get(section);
    return subview === undefined ? undefined : map[subview];
  }

  /**
   * C-527 AC-2 — captures what the host must return the player to.
   *
   * The origin overlay itself is preserved by the overlay stack (a push stacks
   * over it, and a sibling switch replaces only the management entry), so the
   * capture is about the parts the stack does NOT own: the scroll anchor of the
   * surface underneath, and the identity of an open conversation so its draft
   * stays attached to the same actor.
   */
  private _captureReturnContext(): void {
    const activeOverlay = untrack(() => this._overlays.activeOverlay);
    const overlayStack = untrack(() => this._overlays.overlayStack);
    // Most management opens call beginSession before pushing, so the current
    // overlay is the true origin. A production overlay-router trigger can also
    // push first (for example Inventory over Dialogue); in that case the entry
    // below the active management overlay is the origin.
    const originOverlay = isManagementOverlay(activeOverlay)
      ? (overlayStack[overlayStack.length - 2]?.type ?? 'NONE')
      : activeOverlay;
    const npcId = untrack(() => this._npcDialogue.activeNpc?.npcId);
    const scrollAnchor = this._readScrollAnchor();
    this._originFocus =
      typeof document === 'undefined'
        ? undefined
        : ((document.activeElement as HTMLElement | null) ?? undefined);

    this.returnContext = {
      originOverlay,
      ...(npcId === undefined ? {} : { npcId, draftId: `dialogue-draft:${npcId}` }),
      ...(scrollAnchor === undefined ? {} : { scrollAnchor }),
    };
  }

  /**
   * Restores the captured origin after the host closes. Focus and the overlay
   * stack are restored by the router itself; this returns the scroll anchor the
   * player left behind. Guarded so a non-DOM environment is a no-op.
   */
  private _restoreReturnContext(context: ManagementReturnContext | undefined): void {
    if (!context || context.scrollAnchor === undefined) {
      this.returnContext = undefined;
      return;
    }
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: context.scrollAnchor, behavior: 'instant' });
    }
    this.returnContext = undefined;
  }

  /** Scroll anchor of the originating surface, or undefined without a DOM. */
  private _readScrollAnchor(): number | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const anchor = window.scrollY ?? 0;
    return anchor === 0 ? undefined : anchor;
  }

  private _scheduleHostFocus(): void {
    if (typeof requestAnimationFrame !== 'function' || typeof document === 'undefined') {
      return;
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="management-host"]:not([hidden])')?.focus();
    });
  }

  /**
   * Opens a management destination through its existing deep-open entry point.
   * The old entry-point methods stay authoritative (Migration & Rollback): this
   * host is an adapter onto them, not a competing router.
   */
  private _openOverlayDestination(destination: GameOverlayType): void {
    switch (destination) {
      case 'INVENTORY':
        this._overlays.openInventory();
        return;
      case 'QUEST_LOG':
        this._overlays.openQuestLog();
        return;
      case 'JOURNAL':
        this._overlays.openJournal();
        return;
      case 'CHARACTER_DASHBOARD':
        this._overlays.openCharacterDashboard();
        return;
      case 'PARTY_ROSTER':
        this._overlays.openPartyRoster();
        return;
      case 'REPUTATION':
        this._overlays.openReputation();
        return;
      case 'WORLD':
        this._overlays.openWorld();
        return;
      default:
        return;
    }
  }

  /** Closes a management destination through its owning close method. */
  private _closeOverlayDestination(destination: GameOverlayType): void {
    switch (destination) {
      case 'INVENTORY':
        this._overlays.closeInventory();
        return;
      case 'QUEST_LOG':
        this._overlays.closeQuestLog();
        return;
      case 'JOURNAL':
        this._overlays.closeJournal();
        return;
      case 'CHARACTER_DASHBOARD':
        this._overlays.closeCharacterDashboard();
        return;
      case 'PARTY_ROSTER':
        this._overlays.closePartyRoster();
        return;
      case 'REPUTATION':
        this._overlays.closeReputation();
        return;
      case 'WORLD':
        this._overlays.closeWorld();
        return;
      default:
        return;
    }
  }
}

/**
 * Builds a management session from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * goes through the game UI composition.
 */
export const createGameManagementSession = (
  options: GameManagementSessionOptions,
): GameManagementSessionInterface => GameManagementSession.create(options);

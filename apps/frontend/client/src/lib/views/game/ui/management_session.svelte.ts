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
import type { getQuestViewModel } from '$views/quest/quest_composition.ts';
import type { QuestViewModelInterface } from '$views/quest/quest_view_model.svelte.ts';
import type { getWorldViewModel } from '$views/world/world_composition.ts';
import type { WorldTab, WorldViewModelInterface } from '$views/world/world_view_model.svelte';
import type { GameUIOverlayCapabilities } from './game_ui_view_model_types.ts';
import {
  DEFAULT_MENU_LOCATION,
  isManagementOverlay,
  type ManagementLocation,
  type ManagementSectionId,
  managementLocationFromOverlay,
  managementOverlayFor,
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

export type GameManagementSessionOptions = BaseFrontendClassOptions & {
  /** The router: the single authority for what is open. */
  overlays: GameUIOverlayCapabilities;
  /** Conversation identity, captured into the return context. */
  npcDialogue: NpcDialogueServiceInterface;

  // ── Section ViewModel factories (production wiring lives in the composition) ──

  createInventoryViewModel: typeof getInventoryViewModel;
  createQuestViewModel: typeof getQuestViewModel;
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
  /** The last location opened through the host, used by the Menu entry. */
  readonly menuLocation: ManagementLocation;
  /** The captured origin of the current session, or undefined when none. */
  readonly returnContext: ManagementReturnContext | undefined;

  readonly inventoryViewModel: InventoryViewModelInterface | undefined;
  readonly questViewModel: QuestViewModelInterface | undefined;
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
   * Edge trigger: true exactly once, on the open → closed transition, so focus
   * restoration happens after the DOM has re-rendered.
   */
  hostJustClosed(): boolean;
  /** Restores focus to the origin element, or the HUD Menu entry. */
  restoreFocus(): void;
};

class GameManagementSession
  extends BaseFrontendClass<GameManagementSessionOptions>
  implements GameManagementSessionInterface
{
  private readonly _overlays: GameUIOverlayCapabilities;
  private readonly _npcDialogue: NpcDialogueServiceInterface;

  private readonly _createInventoryViewModel: typeof getInventoryViewModel;
  private readonly _createQuestViewModel: typeof getQuestViewModel;
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
  questViewModel = $state<QuestViewModelInterface | undefined>(undefined);
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

  constructor(options: GameManagementSessionOptions) {
    super(options);
    this._overlays = options.overlays;
    this._npcDialogue = options.npcDialogue;
    this._createInventoryViewModel = options.createInventoryViewModel;
    this._createQuestViewModel = options.createQuestViewModel;
    this._createJournalViewModel = options.createJournalViewModel;
    this._createCharacterSheetViewModel = options.createCharacterSheetViewModel;
    this._createPartyRosterViewModel = options.createPartyRosterViewModel;
    this._createReputationViewModel = options.createReputationViewModel;
    this._createWorldViewModel = options.createWorldViewModel;
  }

  /** @inheritdoc */
  get location(): ManagementLocation | undefined {
    return managementLocationFromOverlay(this._overlays.activeOverlay);
  }

  /** @inheritdoc */
  get isOpen(): boolean {
    return isManagementOverlay(this._overlays.activeOverlay);
  }

  /** @inheritdoc */
  openSection(section: ManagementSectionId): void {
    this.openLocation({ section });
  }

  /** @inheritdoc */
  openLocation(location: ManagementLocation): void {
    const normalized = normalizeManagementLocation(location);
    if (!normalized) {
      this.debug('management:open:unknown-section', { section: location.section });
      return;
    }

    if (normalized.subview !== undefined) {
      this._rememberedSubviews.set(normalized.section, normalized.subview);
    }
    this.menuLocation = normalized;

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

  /** @inheritdoc */
  close(): void {
    const context = this.returnContext;
    this._closeOverlayDestination(this._overlays.activeOverlay);
    this._restoreReturnContext(context);
  }

  /** @inheritdoc */
  beginSession(): void {
    if (this.returnContext === undefined) {
      this._captureReturnContext();
    }
  }

  /** @inheritdoc */
  hostJustClosed(): boolean {
    if (this.isOpen) {
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
  restoreFocus(): void {
    if (typeof document === 'undefined') {
      return;
    }
    if (this._originFocus?.isConnected) {
      this._originFocus.focus();
      return;
    }
    document.querySelector<HTMLElement>('[data-testid="hud-menu-entry"]')?.focus();
  }

  /** @inheritdoc */
  ensureSection(overlay: GameOverlayType): void {
    if (this._createdOverlays.has(overlay)) {
      return;
    }
    this._createdOverlays.add(overlay);

    switch (overlay) {
      case 'INVENTORY':
        this.inventoryViewModel = this._createInventoryViewModel({
          className: 'InventoryViewModel',
        });
        return;
      case 'QUEST_LOG':
        this.questViewModel = this._createQuestViewModel({ className: 'QuestViewModel' });
        return;
      case 'JOURNAL': {
        const vm = this._createJournalViewModel({ className: 'JournalViewModel' });
        this.journalViewModel = vm;
        // C-527: restore the subview the player last used in this section.
        const tab = this._rememberedTab('journal', JOURNAL_TAB_BY_SUBVIEW);
        if (tab !== undefined) {
          untrack(() => vm.setActiveTab(tab as JournalTab));
        }
        return;
      }
      case 'CHARACTER_DASHBOARD':
        this.dashboardViewModel = this._createCharacterSheetViewModel({
          className: 'CharacterSheetViewModel',
          onClose: () => this._overlays.closeCharacterDashboard(),
        });
        return;
      case 'PARTY_ROSTER':
        this.partyRosterViewModel = this._createPartyRosterViewModel({
          className: 'PartyRosterViewModel',
        });
        return;
      case 'REPUTATION':
        this.reputationViewModel = this._createReputationViewModel({
          className: 'ReputationViewModel',
        });
        return;
      case 'WORLD': {
        const vm = this._createWorldViewModel({ className: 'WorldViewModel' });
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
    this.questViewModel = undefined;
    this.journalViewModel = undefined;
    this.dashboardViewModel = undefined;
    this.partyRosterViewModel = undefined;
    this.reputationViewModel = undefined;
    this.worldViewModel = undefined;
    this._createdOverlays.clear();
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
    const npcId = untrack(() => this._npcDialogue.activeNpc?.npcId);
    const scrollAnchor = this._readScrollAnchor();
    this._originFocus =
      typeof document === 'undefined'
        ? undefined
        : ((document.activeElement as HTMLElement | null) ?? undefined);

    this.returnContext = {
      originOverlay: this._overlays.activeOverlay,
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

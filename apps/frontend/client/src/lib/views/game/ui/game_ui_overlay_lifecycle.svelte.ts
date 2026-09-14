// apps/frontend/client/src/lib/views/game/ui/game_ui_overlay_lifecycle.svelte.ts
//
// C-527 — the game UI's overlay → ViewModel lifecycle graph.
//
// Every "when overlay X becomes active, create its ViewModel; when it stops
// being active, tear it down" rule used to live inline in
// `game_ui_view_model.svelte.ts`, which pushed that file past its reviewed size
// ceiling. The rules are one cohesive responsibility — the lifecycle graph —
// and this module owns them.
//
// The ViewModel keeps the reactive fields; this module is handed setters and
// getters for them, so reactivity is unchanged (the effects still write the same
// `$state`), and `initialize()` shrinks to "wire the ports, start the graph".
//
// Ownership note: management sections are NOT created here. The management host
// session keeps each section's ViewModel alive across sibling switches
// (C-527 AC-2), so its lifecycle is deliberately different from the
// one-owner-per-activation rule below — see `management_session.svelte.ts`.

import { untrack } from 'svelte';
import type { NpcDialogueServiceInterface } from '$services';
import type { GameOverlayType } from '$types';
import type { getCombatViewModel } from '$views/combat/combat_composition.ts';
import type {
  CombatViewModel,
  CombatViewModelInterface,
} from '$views/combat/combat_view_model.svelte';
import type { getDialogueOverlayViewModel } from '$views/game/ui/overlays/dialogue/dialogue_overlay_composition.ts';
import type { DialogueOverlayViewModelInterface } from '$views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte';
import type { getEndSessionViewModel } from '$views/game/ui/overlays/end_session/end_session_composition.ts';
import type { EndSessionViewModelInterface } from '$views/game/ui/overlays/end_session/end_session_view_model.svelte';
import type { getSettingsOverlayViewModel } from '$views/game/ui/overlays/settings/settings_overlay_composition.ts';
import type { SettingsOverlayViewModelInterface } from '$views/game/ui/overlays/settings/settings_overlay_view_model.svelte';
import type { getTalkToPartyViewModel } from '$views/game/ui/overlays/talk_to_party/talk_to_party_composition.ts';
import type { TalkToPartyViewModelInterface } from '$views/game/ui/overlays/talk_to_party/talk_to_party_view_model.svelte';
import type { getVendorViewModel } from '$views/vendor/vendor_composition.ts';
import type { VendorViewModelInterface } from '$views/vendor/vendor_view_model.svelte';
import type {
  GameUIChatCapabilities,
  GameUICombatStateCapabilities,
  GameUIOverlayCapabilities,
  GameUISessionCapabilities,
} from './game_ui_view_model_types.ts';
import type { GameManagementSessionInterface } from './management_session.svelte.ts';

export type GameUIOverlayLifecycleOptions = {
  /** The ViewModel's effect root, so these effects die with it. */
  registerEffectRoot: (fn: () => void) => void;
  /** The router: the single authority for what is open. */
  overlays: GameUIOverlayCapabilities;
  /** Conversation source for the dialogue ViewModel. */
  npcDialogue: NpcDialogueServiceInterface;
  /** Combat service state read when the combat overlay activates. */
  combat: GameUICombatStateCapabilities;
  /** Chat state read for the auto-summary threshold effect. */
  chat: GameUIChatCapabilities;
  /** Session state read for the auto-summary threshold effect. */
  session: GameUISessionCapabilities;
  /** The management host session (its own effect pair lives here too). */
  management: GameManagementSessionInterface;

  createDialogueOverlayViewModel: typeof getDialogueOverlayViewModel;
  createCombatViewModel: typeof getCombatViewModel;
  createVendorViewModel: typeof getVendorViewModel;
  createTalkToPartyViewModel: typeof getTalkToPartyViewModel;
  createEndSessionViewModel: typeof getEndSessionViewModel;
  createSettingsOverlayViewModel: typeof getSettingsOverlayViewModel;

  setDialogueViewModel(vm: DialogueOverlayViewModelInterface | undefined): void;
  setCombatViewModel(vm: CombatViewModelInterface | undefined): void;
  setVendorViewModel(vm: VendorViewModelInterface | undefined): void;
  setTalkToPartyViewModel(vm: TalkToPartyViewModelInterface | undefined): void;
  setEndSessionViewModel(vm: EndSessionViewModelInterface | undefined): void;
  setSettingsOverlayViewModel(vm: SettingsOverlayViewModelInterface | undefined): void;

  getDialogueViewModel(): DialogueOverlayViewModelInterface | undefined;
};

/**
 * Creates the ViewModel for a NON-management "simple" overlay and returns its
 * cleanup. Management sections are owned by the management session so a section
 * keeps its own state across sibling switches (C-527 AC-2).
 */
const simpleOverlayCleanup = (
  overlay: GameOverlayType,
  options: GameUIOverlayLifecycleOptions,
): (() => void) | undefined => {
  if (overlay === 'END_SESSION') {
    options.setEndSessionViewModel(
      options.createEndSessionViewModel({ className: 'EndSessionViewModel' }),
    );
    return () => {
      options.setEndSessionViewModel(undefined);
    };
  }
  if (overlay === 'SETTINGS') {
    options.setSettingsOverlayViewModel(
      options.createSettingsOverlayViewModel({ className: 'SettingsOverlayViewModel' }),
    );
    return () => {
      options.setSettingsOverlayViewModel(undefined);
    };
  }
  return undefined;
};

/**
 * Registers the whole overlay lifecycle graph on the ViewModel's effect root.
 *
 * Idempotent per call; the caller is responsible for calling it once from
 * `initialize()`.
 */
export const registerGameUIOverlayLifecycle = (options: GameUIOverlayLifecycleOptions): void => {
  const { overlays, npcDialogue, management } = options;

  options.registerEffectRoot(() => {
    // ── Dialogue ──
    $effect(() => {
      if (overlays.activeOverlay !== 'DIALOGUE') {
        return;
      }
      const npc = npcDialogue.activeNpc;
      if (!npc) {
        return;
      }
      const vm = options.createDialogueOverlayViewModel({
        className: 'DialogueOverlayViewModel',
        npcData: npc,
        onEndChat: () => overlays.endDialogue(),
        npcDialogueService: npcDialogue,
        onStartCombat: (combatNpcData) => {
          overlays.startCombat({
            enemyName: combatNpcData.npcName,
            enemyNpcId: combatNpcData.npcId,
          });
        },
      });
      options.setDialogueViewModel(vm);

      return () => {
        vm.hasNpcScreenPosition = false;
        options.setDialogueViewModel(undefined);
      };
    });

    // ── Combat ──
    //
    // Lifecycle owner for the combat overlay: ONE ViewModel per overlay
    // activation. The combat service's live state is read UNTRACKED on purpose —
    // `COMBAT_STARTED`/`TURN_CHANGED` mutate it, and a tracked read would tear
    // this ViewModel down and build a fresh one the moment the engine answered,
    // discarding the turn/budget events it had just received (no turn tracker,
    // no budget dots, no End Turn). The ViewModel is event-driven: it seeds from
    // whatever the service knows at open time and updates itself from the bridge
    // for everything after.
    $effect(() => {
      if (overlays.activeOverlay !== 'COMBAT') {
        return;
      }
      const vm = options.createCombatViewModel({
        className: 'CombatViewModel',
        onDismissOverlay: () => overlays.closeCombat(),
      }) as CombatViewModel;
      const seed = untrack(() => {
        const cs = options.combat;
        return {
          enemyName: cs.enemyName,
          enemyNpcId: cs.enemyNpcId,
          enemyHp: cs.enemyHp,
          enemyMaxHp: cs.enemyMaxHp,
          participantIds: [...cs.participantIds],
          firstTurnEntityId: cs.firstTurnEntityId,
        };
      });
      void vm.initialize();
      vm.enemyName = seed.enemyName || 'Enemy';
      vm.enemyNpcId = seed.enemyNpcId;
      vm.enemyHp = seed.enemyHp;
      vm.enemyMaxHp = seed.enemyMaxHp;
      vm.activeEntities = seed.participantIds;
      vm.currentTurnEntity = seed.firstTurnEntityId;
      vm.totalParticipants = seed.participantIds.length;
      vm.isPlayerTurn = true;
      options.setCombatViewModel(vm);

      return () => {
        void vm.dispose();
        options.setCombatViewModel(undefined);
      };
    });

    // ── Non-management simple overlays (End Session, Settings) — one
    //    lifecycle owner per active overlay, created and cleared centrally. ──
    $effect(() => simpleOverlayCleanup(overlays.activeOverlay, options));

    // ── Management host session (C-527 AC-2) ──
    //
    // One session per host open. While the session is live, each visited
    // section's ViewModel is created ONCE and kept alive, so switching a sibling
    // section preserves that section's own state. The session ends — and every
    // section ViewModel is released — when the active overlay stops being a
    // management destination (including a "Back to game" close).
    $effect(() => {
      if (!management.isOpen) {
        return;
      }
      management.beginSession();
      management.ensureSection(overlays.activeOverlay);

      return () => {
        // Only tear down when the host really ended — a sibling switch also runs
        // this cleanup, and the overlay that replaced it is still a management
        // destination.
        if (management.isOpen) {
          return;
        }
        management.disposeSections();
      };
    });

    // ── Focus restoration after the host closes (C-527 AC-3) ──
    //
    // Runs as an effect (rather than in the cleanup above) so it happens AFTER
    // the DOM has re-rendered and the HUD Menu entry is mounted again.
    $effect(() => {
      if (!management.hostJustClosed()) {
        return;
      }
      untrack(() => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => management.restoreFocus());
        } else {
          management.restoreFocus();
        }
      });
    });

    // ── Vendor ──
    $effect(() => {
      if (overlays.activeOverlay !== 'VENDOR') {
        return;
      }
      const opts = overlays.vendorSessionOptions;
      if (!opts) {
        return;
      }
      const vm = options.createVendorViewModel({
        className: 'VendorViewModel',
        vendorId: opts.vendorId,
        vendorName: opts.vendorName,
        vendorInventory: opts.vendorInventory,
      });
      options.setVendorViewModel(vm);

      return () => {
        void vm.dispose();
        options.setVendorViewModel(undefined);
      };
    });

    // ── Talk to Party (C-340) ──
    $effect(() => {
      if (overlays.activeOverlay !== 'TALK_TO_PARTY') {
        return;
      }
      // Talk to Party is opened with companion context from party roster.
      // For now, open default — the router populates context from the last
      // companion talked to.
      const vm = options.createTalkToPartyViewModel({
        className: 'TalkToPartyViewModel',
        npcId: '', // populated by the party roster button
        npcName: 'Companion',
        npcDialogueService: npcDialogue,
      });
      options.setTalkToPartyViewModel(vm);

      return () => {
        options.setTalkToPartyViewModel(undefined);
      };
    });

    // Camera zoom forwarding (for dialogue spatial UI)
    $effect(() => {
      const x = overlays._cameraZoomNpcScreenX;
      const y = overlays._cameraZoomNpcScreenY;
      const dialogue = options.getDialogueViewModel();
      if (!dialogue) {
        return;
      }
      if (x !== undefined) {
        dialogue.npcScreenX = x;
        dialogue.npcScreenY = y ?? 0;
        dialogue.hasNpcScreenPosition = true;
      } else {
        dialogue.hasNpcScreenPosition = false;
      }
    });
  });

  // Auto-summary threshold check (C-240)
  options.registerEffectRoot(() => {
    $effect(() => {
      void options.chat.messages.length;
      options.session.checkAutoSummaryThreshold();
    });
  });
};

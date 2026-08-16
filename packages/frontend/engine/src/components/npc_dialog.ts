// apps/frontend/game/src/engine/components/npc_dialog.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// NPCDialog — SoA component for interactable NPCs
// ---------------------------------------------------------------------------

/**
 * Default interaction radius for NPCs in pixels.
 *
 * Lives in the component module (CodeRabbit review, C-402) so movement
 * systems (goap_movement_executor, path_follow_system) can read the spawn
 * default without depending on the heavy entity_spawner module — keeping
 * the dependency direction leaf-ward and avoiding an import cycle if the
 * spawner ever needs executor state.
 */
export const DEFAULT_INTERACTION_RADIUS = 50;

/** SoA storage for NPC dialog data. Indexed by entity ID. */
export const NPCDialog = {
  npcId: [] as string[],
  npcName: [] as string[],
  dialog: [] as string[],
  interactionRadius: [] as number[],
  playerInRange: [] as boolean[],
  /** Whether this NPC is a vendor (opens VendorView instead of DialogueOverlay). Contract: C-154 */
  isVendor: [] as boolean[],
  /**
   * Comma-separated list of item IDs the vendor sells.
   * Parsed from Tiled properties.
   *
   * Contract: C-154 AI Vendors Economy
   */
  vendorInventory: [] as string[],
};

/** Payload shape stored/retrieved via observers. */
export type NPCDialogData = {
  npcId: string;
  npcName: string;
  dialog: string;
  interactionRadius: number;
  playerInRange: boolean;
  isVendor: boolean;
  vendorInventory: string;
};

/**
 * Registers onSet and onGet observers for the NPCDialog component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerNPCDialogObservers = (world: World): void => {
  observe(world, onSet(NPCDialog), (eid: number, params: NPCDialogData) => {
    NPCDialog.npcId[eid] = params.npcId;
    NPCDialog.npcName[eid] = params.npcName;
    NPCDialog.dialog[eid] = params.dialog;
    NPCDialog.interactionRadius[eid] = params.interactionRadius;
    NPCDialog.playerInRange[eid] = params.playerInRange;
    NPCDialog.isVendor[eid] = params.isVendor;
    NPCDialog.vendorInventory[eid] = params.vendorInventory;
  });

  observe(
    world,
    onGet(NPCDialog),
    (eid: number): NPCDialogData => ({
      npcId: NPCDialog.npcId[eid],
      npcName: NPCDialog.npcName[eid],
      dialog: NPCDialog.dialog[eid],
      interactionRadius: NPCDialog.interactionRadius[eid],
      playerInRange: NPCDialog.playerInRange[eid],
      isVendor: NPCDialog.isVendor[eid] ?? false,
      vendorInventory: NPCDialog.vendorInventory[eid] ?? '',
    }),
  );
};

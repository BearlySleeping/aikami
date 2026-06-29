// packages/frontend/engine/src/components/text_identity.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// TextIdentity — zero-allocation text identity via registry handles
//
// Contract C-195: Components store purely sequential uint32 numeric handles
// that map back to memory records in the StringRegistryService. This
// eliminates heap string allocations from the hot component read path.
//
// Field semantics:
// - nameHandle: uint32 handle → entity display name (e.g. "Goblin Scout")
// - dialogueScriptHandle: uint32 handle → active conversation block text
//
// Both fields are plain number arrays (SoA pattern). 0 is the null/empty
// sentinel — StringRegistryService.resolve(0) returns undefined.
//
// String resolution is deferred to downstream systems (UI bridge, log
// formatter, serialization layer) that call StringRegistryService.resolve()
// only when the resolved text is actually needed for display or persistence.
// ---------------------------------------------------------------------------

/** SoA storage for text identity registry handles. Indexed by entity ID. */
export const TextIdentity = {
  /** Handle into StringRegistryService for the entity's display name. */
  nameHandle: [] as number[],
  /** Handle into StringRegistryService for the active dialogue script block. */
  dialogueScriptHandle: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type TextIdentityData = {
  nameHandle: number;
  dialogueScriptHandle: number;
};

/**
 * Registers onSet and onGet observers for the TextIdentity component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerTextIdentityObservers = (world: World): void => {
  observe(world, onSet(TextIdentity), (eid: number, params: TextIdentityData) => {
    TextIdentity.nameHandle[eid] = params.nameHandle;
    TextIdentity.dialogueScriptHandle[eid] = params.dialogueScriptHandle;
  });

  observe(
    world,
    onGet(TextIdentity),
    (eid: number): TextIdentityData => ({
      nameHandle: TextIdentity.nameHandle[eid],
      dialogueScriptHandle: TextIdentity.dialogueScriptHandle[eid],
    }),
  );
};

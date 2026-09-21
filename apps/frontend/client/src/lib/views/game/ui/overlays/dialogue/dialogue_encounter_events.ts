// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_encounter_events.ts
//
// Dialogue→engine encounter events. Extracted from the ViewModel so the
// standalone-bridge emission (C-330 AC-4) is reusable and the ViewModel stays
// within its size budget.

/**
 * Emits an ENCOUNTER_COMPLETED event via a standalone engine bridge, using the
 * same pattern as quest_state_service. Fire-and-forget: the bridge is imported
 * lazily to keep the engine bundle out of the initial dialogue chunk.
 */
export const emitEncounterCompleted = (encounterId: string, victory: boolean): void => {
  void import('@aikami/frontend/engine').then(({ createEngineBridge }) => {
    const bridge = createEngineBridge();
    bridge.emit({ type: 'ENCOUNTER_COMPLETED', encounterId, victory });
  });
};

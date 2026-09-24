// apps/e2e/src/visual/core/entity_texture_guard.ts
//
// C-550: visual evidence must fail closed when an entity is still a placeholder.
// The generated-artifact fingerprint proves map/atlas bytes, but it cannot prove
// that asynchronous actor textures resolved before a screenshot.

/** Stable policy identifier recorded in capture metadata and expected artifacts. */
export const ENTITY_TEXTURE_GUARD_POLICY = 'visible-entity-textures-v1' as const;

/** One visible scene-graph display reduced to texture-resolution evidence. */
export type EntityTextureObservation = {
  entityId: string;
  visible: boolean;
  displayType: 'sprite' | 'composed' | 'graphics' | 'missing';
  resolvedTextureCount: number;
  unresolvedTextureCount: number;
};

/** True when a visible display has at least one real texture and no fallback texture. */
export const isEntityTextureResolved = (observation: EntityTextureObservation): boolean =>
  observation.visible &&
  observation.displayType !== 'missing' &&
  observation.resolvedTextureCount > 0 &&
  observation.unresolvedTextureCount === 0;

/**
 * Throws when any visible entity display is missing, still a primitive
 * placeholder, or contains a 1×1/failed texture.
 */
export const assertEntityTexturesResolved = (
  observations: readonly EntityTextureObservation[],
): void => {
  const failures = observations.filter(
    (observation) => observation.visible && !isEntityTextureResolved(observation),
  );
  if (failures.length === 0) {
    return;
  }
  const summary = failures
    .map(
      (observation) =>
        `${observation.entityId}:${observation.displayType} (${observation.resolvedTextureCount} resolved, ${observation.unresolvedTextureCount} unresolved)`,
    )
    .join(', ');
  throw new Error(`C-550 entity texture guard failed; visible placeholders: ${summary}`);
};

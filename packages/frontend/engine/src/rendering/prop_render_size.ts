// packages/frontend/engine/src/rendering/prop_render_size.ts

/** Authored logical render size, in world pixels. */
export type PropRenderSize = {
  width?: number;
  height?: number;
};

/**
 * Resolves the logical world render size for a prop.
 *
 * A single authored axis derives the other from the source aspect ratio, while
 * two authored axes remain an explicit request to change that ratio.
 */
export const computePropRenderSize = (options: {
  textureWidth: number;
  textureHeight: number;
  renderWidth?: number;
  renderHeight?: number;
}): { width: number; height: number } => {
  const nativeWidth = Math.max(1, options.textureWidth);
  const nativeHeight = Math.max(1, options.textureHeight);
  const { renderWidth, renderHeight } = options;

  if (renderWidth !== undefined && renderHeight !== undefined) {
    return { width: Math.max(1, renderWidth), height: Math.max(1, renderHeight) };
  }
  if (renderWidth !== undefined) {
    return {
      width: Math.max(1, renderWidth),
      height: Math.max(1, (renderWidth * nativeHeight) / nativeWidth),
    };
  }
  if (renderHeight !== undefined) {
    return {
      width: Math.max(1, (renderHeight * nativeWidth) / nativeHeight),
      height: Math.max(1, renderHeight),
    };
  }
  return { width: nativeWidth, height: nativeHeight };
};

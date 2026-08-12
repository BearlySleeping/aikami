// packages/frontend/engine/src/rendering/pixel_snap.ts
//
// Contract C-377 AC-3 — device-pixel snapping for the world container.
//
// The world container transform is the single place where continuous
// world coordinates (lerped camera position × scale) become device
// pixels. Snapping there keeps the tile grid stable while the camera
// moves — the camera's own lerp stays continuous so movement stays
// smooth. The snap accounts for renderer resolution: rounding to whole
// CSS pixels would still land on half device pixels at DPR 2.

/**
 * Rounds a CSS-pixel coordinate to the nearest whole device pixel.
 *
 * `value * resolution` is an integer after snapping, for any resolution.
 * Pure and unit-testable (C-377 AC-3).
 *
 * @param value - The coordinate in CSS pixels (may be fractional).
 * @param resolution - The renderer resolution (devicePixelRatio, clamped).
 * @returns The snapped coordinate in CSS pixels.
 */
export const snapToDevicePixels = (value: number, resolution: number): number => {
  if (!Number.isFinite(value) || resolution <= 0) {
    return value;
  }
  return Math.round(value * resolution) / resolution;
};

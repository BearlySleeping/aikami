// apps/frontend/client/src/lib/data/lpc_asset_path_mapper.ts
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// LPC Asset Path Mapper — connects asset IDs to local static file directories
//
// Maps LPC asset numeric IDs to file paths under
// `static/assets/spritesheets/`. When files are missing at runtime, generates
// high-visibility 64×64 placeholder blocks containing the slot name so
// development workflows stay stable during asset pipeline gaps.
//
// For dev/emulator mode, `generateMockLpcSheet` builds a full 832×1344
// procedural spritesheet with variant-specific geometric shapes in all 21
// animation rows. This enables the visual workbench to render fully animated
// characters even without real LPC asset files — no magenta placeholders,
// just distinct, directional silhouettes per variant (C-049).
// ---------------------------------------------------------------------------

/** Base URL for LPC spritesheet assets relative to the static directory. */
const LPC_ASSET_BASE_PATH = '/assets/spritesheets';

/** LPC standard frame dimensions. */
const LPC_FRAME_SIZE = 64;

/** LPC spritesheet columns (13 animation frames per row). */
const LPC_COLUMNS = 13;

/** LPC spritesheet rows (21 rows across all animation states). */
const LPC_ROWS = 21;

/** LPC standard spritesheet width (13 × 64). */
const LPC_SHEET_WIDTH = LPC_COLUMNS * LPC_FRAME_SIZE;

/** LPC standard spritesheet height (21 × 64). */
const LPC_SHEET_HEIGHT = LPC_ROWS * LPC_FRAME_SIZE;

/** Row ranges for each LPC animation state. */
const STATE_ROWS = {
  spellcast: { start: 0, end: 3 },
  thrust: { start: 4, end: 7 },
  walk: { start: 8, end: 11 },
  slash: { start: 12, end: 15 },
  shoot: { start: 16, end: 19 },
  die: { start: 20, end: 20 },
} as const;

/** Direction name per walk row offset. */
// Reserved for future direction-label logging in mock sheet generation
const _WALK_DIRECTION_NAMES = ['up', 'left', 'down', 'right'] as const;

/**
 * Asset slot category to filename prefix mapping.
 *
 * Each LPC layer slot maps to a consistent file naming convention.
 * Example: body layer assets are `body_{id}.png`, hair → `hair_{id}.png`.
 */
const SLOT_FILE_PREFIX: Record<string, string> = {
  body: 'body',
  head: 'head',
  hair: 'hair',
  torso: 'torso',
  legs: 'legs',
  feet: 'feet',
  weapon: 'weapon',
};

// ---------------------------------------------------------------------------
// Procedural mock spritesheet generator (C-049)
// ---------------------------------------------------------------------------

/**
 * Generates a full 832×1344 procedural LPC spritesheet as an offscreen canvas.
 *
 * Paints distinct geometric feature shapes into each of the 273 cells
 * (13 columns × 21 rows, 64×64 per cell) based on the slot type and variant.
 * The returned canvas can be passed directly to `Texture.from(canvas)` in PixiJS,
 * providing instant image sources when external asset files are missing.
 *
 * Row layout follows the Universal LPC spritesheet architecture:
 * - Rows 0–3:  Spellcast (Up, Left, Down, Right)
 * - Rows 4–7:  Thrust
 * - Rows 8–11: Walk
 * - Rows 12–15: Slash
 * - Rows 16–19: Shoot
 * - Row 20:    Die
 *
 * Each column within a row varies the shape slightly to simulate
 * animation frame progression (limb sway, weapon angle, armor shift).
 *
 * @param slotType - LPC layer slot name (e.g. 'body', 'hair', 'weapon').
 * @param shapeType - Mock shape variant identifier for visual differentiation.
 * @returns An HTMLCanvasElement (832×1344) with the procedural spritesheet.
 */
export const generateMockLpcSheet = (slotType: string, shapeType: string): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = LPC_SHEET_WIDTH;
  canvas.height = LPC_SHEET_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logger.error('lpcMockSheet.noContext', { slotType, shapeType });
    return canvas;
  }

  ctx.clearRect(0, 0, LPC_SHEET_WIDTH, LPC_SHEET_HEIGHT);

  for (let row = 0; row < LPC_ROWS; row++) {
    const directionOffset = _getWalkDirectionOffset(row);
    const stateLabel = _getStateLabel(row);

    for (let col = 0; col < LPC_COLUMNS; col++) {
      const fx = col * LPC_FRAME_SIZE;
      const fy = row * LPC_FRAME_SIZE;

      const phase = col / LPC_COLUMNS;
      const stateFrameCount = _framesForState(stateLabel);
      const frameIdx = col % stateFrameCount;
      const framePhase = stateFrameCount > 1 ? frameIdx / (stateFrameCount - 1) : 0;

      ctx.save();
      ctx.translate(fx, fy);

      _drawCellShape(ctx, {
        slotType,
        shapeType,
        row,
        col,
        phase,
        framePhase,
        frameIdx,
        directionOffset,
        stateLabel,
        isWalkRow: row >= STATE_ROWS.walk.start && row <= STATE_ROWS.walk.end,
      });

      ctx.restore();
    }
  }

  return canvas;
};

/**
 * Generates a full 832×1344 procedural LPC spritesheet as a base64 data-URL.
 *
 * Wraps {@link generateMockLpcSheet} with `canvas.toDataURL()`. Use when
 * the texture needs to be serialized or passed to an Image element src.
 * For PixiJS textures, prefer passing the canvas directly via
 * `Texture.from(canvas)` to avoid async image decode latency.
 *
 * @param slotType - LPC layer slot name.
 * @param shapeType - Mock shape variant identifier.
 * @returns A base64 PNG data-URL string.
 */
export const generateMockLpcSheetDataUrl = (slotType: string, shapeType: string): string => {
  const canvas = generateMockLpcSheet(slotType, shapeType);
  return canvas.toDataURL('image/png');
};

/**
 * Creates a PixiJS Texture from a procedural mock LPC spritesheet.
 *
 * Convenience wrapper that calls generateMockLpcSheet and wraps
 * the resulting canvas element in a PixiJS Texture configured with
 * NEAREST scaling for pixel-accurate rendering.
 *
 * @param slotType - LPC layer slot name.
 * @param shapeType - Mock shape variant identifier.
 * @returns A PixiJS Texture ready for rendering.
 */
export const createMockSheetTexture = async (slotType: string, shapeType: string) => {
  const { Texture } = await import('pixi.js');

  const canvas = generateMockLpcSheet(slotType, shapeType);
  if (!canvas) {
    return Texture.EMPTY;
  }

  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
};

// ---------------------------------------------------------------------------
// Shape drawing helpers
// ---------------------------------------------------------------------------

type CellDrawOptions = {
  slotType: string;
  shapeType: string;
  row: number;
  col: number;
  phase: number;
  framePhase: number;
  frameIdx: number;
  directionOffset: number;
  stateLabel: string;
  isWalkRow: boolean;
};

/**
 * Dispatches drawing to the appropriate shape renderer based on slot + shape.
 */
const _drawCellShape = (ctx: CanvasRenderingContext2D, options: CellDrawOptions): void => {
  const { slotType } = options;

  switch (slotType) {
    case 'body':
    case 'head':
      _drawBodyCell(ctx, options);
      break;
    case 'hair':
      _drawHairCell(ctx, options);
      break;
    case 'torso':
      _drawTorsoCell(ctx, options);
      break;
    case 'legs':
      _drawLegsCell(ctx, options);
      break;
    case 'weapon':
      _drawWeaponCell(ctx, options);
      break;
    default:
      _drawDefaultCell(ctx, options);
      break;
  }
};

/**
 * Returns 0–3 walk direction offset for a given row.
 *
 * Walk rows 8–11 map to directions Up(0), Left(1), Down(2), Right(3).
 * For non-walk rows, cycles through the offset based on row modulus.
 */
const _getWalkDirectionOffset = (row: number): number => {
  if (row >= STATE_ROWS.walk.start && row <= STATE_ROWS.walk.end) {
    return row - STATE_ROWS.walk.start;
  }
  // For other state blocks, each 4-row block cycles Up/Left/Down/Right
  return row % 4;
};

/** Returns a state label for a given spritesheet row. */
const _getStateLabel = (row: number): string => {
  if (row <= STATE_ROWS.spellcast.end) {
    return 'spellcast';
  }
  if (row <= STATE_ROWS.thrust.end) {
    return 'thrust';
  }
  if (row <= STATE_ROWS.walk.end) {
    return 'walk';
  }
  if (row <= STATE_ROWS.slash.end) {
    return 'slash';
  }
  if (row <= STATE_ROWS.shoot.end) {
    return 'shoot';
  }
  return 'die';
};

/** Returns frame count for an animation state. */
const _framesForState = (state: string): number => {
  switch (state) {
    case 'spellcast':
      return 7;
    case 'thrust':
      return 8;
    case 'walk':
      return 9;
    case 'slash':
      return 6;
    case 'shoot':
      return 13;
    case 'die':
      return 1;
    default:
      return 13;
  }
};

// ---------------------------------------------------------------------------
// Body silhouette renderer
// ---------------------------------------------------------------------------

/**
 * Draws a body/head silhouette in a 64×64 cell.
 *
 * The base shape is a humanoid stick-figure with distinct per-variant features:
 * - humanoid: standard torso + head + limbs
 * - elf: humanoid with pointed ears
 * - skeleton: thin bone lines with joint circles
 *
 * Animation phase varies limb positions for a walk-cycle illusion.
 */
const _drawBodyCell = (ctx: CanvasRenderingContext2D, options: CellDrawOptions): void => {
  const { shapeType, framePhase, row, isWalkRow, directionOffset } = options;
  const cx = 32;
  const cy = 24;
  const radius = 10;

  const baseColors = [
    '#e8b88a',
    '#c69c6d',
    '#a67c52',
    '#d4a070',
    '#c69c6d',
    '#e8b88a',
    '#a67c52',
    '#d4a070',
    '#e8b88a',
    '#c69c6d',
    '#a67c52',
    '#d4a070',
  ];

  // Head circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);

  if (shapeType === 'skeleton') {
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pointy chin
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + 6);
    ctx.lineTo(cx, cy + 14);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.stroke();
  } else {
    // Fill base body color based on row
    const colorIdx = row % baseColors.length;
    ctx.fillStyle = baseColors[colorIdx] ?? '#e8b88a';
    ctx.fill();
    ctx.strokeStyle = '#8b5e3c';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Elf ears
    if (shapeType === 'elf') {
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy - 2);
      ctx.lineTo(cx - radius - 6, cy - 8);
      ctx.lineTo(cx - radius + 2, cy + 1);
      ctx.fillStyle = '#e8b88a';
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx + radius, cy - 2);
      ctx.lineTo(cx + radius + 6, cy - 8);
      ctx.lineTo(cx + radius - 2, cy + 1);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Torso
  const shoulderY = cy + radius + 2;
  const torsoHeight = 20;
  const shoulderWidth = 16;

  if (shapeType === 'skeleton') {
    // Spine line
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(cx, shoulderY + torsoHeight);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Ribcage
    for (let r = 0; r < 4; r++) {
      const ribY = shoulderY + 2 + r * 4;
      ctx.beginPath();
      ctx.moveTo(cx - 6, ribY);
      ctx.lineTo(cx + 6, ribY);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = _blendColor('#8b5e3c', baseColors, row);
    ctx.fillRect(cx - shoulderWidth / 2, shoulderY, shoulderWidth, torsoHeight);
    ctx.strokeStyle = '#6b3e1c';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - shoulderWidth / 2, shoulderY, shoulderWidth, torsoHeight);
  }

  // Limbs — animated based on frame phase for walk rows
  const hipY = shoulderY + torsoHeight;
  const limbSwing = isWalkRow ? Math.sin(framePhase * Math.PI * 2) * 8 : 0;
  const limbSwingOffset = isWalkRow ? Math.cos(framePhase * Math.PI * 2) * 8 : 0;

  // Adjust limb swing direction based on walk direction
  const leftArmSwing = limbSwing;
  const rightArmSwing = -limbSwing;
  const leftLegSwing = -limbSwing;
  const rightLegSwing = limbSwing;

  // Arms
  const armLen = 16;
  const armColor = shapeType === 'skeleton' ? '#cccccc' : _blendColor('#d4a070', baseColors, row);
  ctx.strokeStyle = armColor;
  ctx.lineWidth = shapeType === 'skeleton' ? 1.5 : 3;
  ctx.lineCap = 'round';

  // Left arm
  ctx.beginPath();
  ctx.moveTo(cx - shoulderWidth / 2, shoulderY + 2);
  ctx.lineTo(
    cx - shoulderWidth / 2 - 4 + leftArmSwing * 0.3,
    shoulderY + armLen + leftArmSwing * 0.5,
  );
  ctx.stroke();

  // Right arm
  ctx.beginPath();
  ctx.moveTo(cx + shoulderWidth / 2, shoulderY + 2);
  ctx.lineTo(
    cx + shoulderWidth / 2 + 4 + rightArmSwing * 0.3,
    shoulderY + armLen + rightArmSwing * 0.5,
  );
  ctx.stroke();

  // Legs
  const legLen = 18;
  const legColor = shapeType === 'skeleton' ? '#cccccc' : _blendColor('#6b4e30', baseColors, row);
  ctx.strokeStyle = legColor;

  // Left leg
  ctx.beginPath();
  ctx.moveTo(cx - 4, hipY);
  ctx.lineTo(cx - 4 + leftLegSwing * 0.4, hipY + legLen + limbSwingOffset * 0.6);
  ctx.stroke();

  // Right leg
  ctx.beginPath();
  ctx.moveTo(cx + 4, hipY);
  ctx.lineTo(cx + 4 + rightLegSwing * 0.4, hipY + legLen + limbSwingOffset * 0.6);
  ctx.stroke();

  if (shapeType === 'skeleton') {
    // Joint circles
    const drawJoint = (jx: number, jy: number): void => {
      ctx.beginPath();
      ctx.arc(jx, jy, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    };

    drawJoint(cx, shoulderY);
    drawJoint(cx - shoulderWidth / 2, shoulderY + 2);
    drawJoint(cx + shoulderWidth / 2, shoulderY + 2);
    drawJoint(cx - 4, hipY);
    drawJoint(cx + 4, hipY);
  }

  // Eyes
  _drawEyes(ctx, cx, cy, options);

  // Direction indicator — small triangle showing facing direction for walk rows
  if (isWalkRow) {
    _drawDirectionIndicator(ctx, cx, cy - radius - 6, directionOffset);
  }
};

/** Draws simple dot eyes varying slightly by frame phase. */
const _drawEyes = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  options: CellDrawOptions,
): void => {
  const { framePhase } = options;
  const eyeOffset = 3;
  const eyeY = cy - 2;
  const blinkScale = framePhase < 0.1 ? 0.3 : 1;

  ctx.fillStyle = '#333333';

  // Left eye
  ctx.beginPath();
  ctx.ellipse(cx - eyeOffset, eyeY, 1.5, 1.5 * blinkScale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Right eye
  ctx.beginPath();
  ctx.ellipse(cx + eyeOffset, eyeY, 1.5, 1.5 * blinkScale, 0, 0, Math.PI * 2);
  ctx.fill();
};

/** Draws a small arrow indicating facing direction. */
const _drawDirectionIndicator = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  direction: number,
): void => {
  ctx.fillStyle = '#ffff00';
  ctx.beginPath();

  switch (direction) {
    case 0: // Up
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx - 4, cy);
      ctx.lineTo(cx + 4, cy);
      break;
    case 1: // Left
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx, cy - 4);
      ctx.lineTo(cx, cy + 4);
      break;
    case 2: // Down
      ctx.moveTo(cx, cy + 6);
      ctx.lineTo(cx - 4, cy);
      ctx.lineTo(cx + 4, cy);
      break;
    case 3: // Right
      ctx.moveTo(cx + 6, cy);
      ctx.lineTo(cx, cy - 4);
      ctx.lineTo(cx, cy + 4);
      break;
  }

  ctx.fill();
};

// ---------------------------------------------------------------------------
// Hair renderer
// ---------------------------------------------------------------------------

const _drawHairCell = (ctx: CanvasRenderingContext2D, options: CellDrawOptions): void => {
  const { shapeType, framePhase } = options;
  const cx = 32;
  const cy = 14;
  const headRadius = 10;

  ctx.fillStyle = _hairColor(options);
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;

  switch (shapeType) {
    case 'mohawk': {
      // Spiky triangle ridge along center
      ctx.beginPath();
      ctx.moveTo(cx, cy - headRadius);
      for (let i = 0; i < 7; i++) {
        const spikeX = cx - 8 + i * 2.5;
        const spikeY = cy - headRadius - 4 - (i % 2) * 4;
        ctx.lineTo(spikeX, spikeY);
      }
      ctx.lineTo(cx + 8, cy - headRadius);
      ctx.lineTo(cx + headRadius / 2, cy + 4);
      ctx.lineTo(cx - headRadius / 2, cy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'long_braid': {
      // Long flowing braid from back of head
      const sway = Math.sin(framePhase * Math.PI * 2) * 3;
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy + headRadius - 2);
      ctx.lineTo(cx + 2, cy + headRadius - 2);
      ctx.lineTo(cx + 2 + sway, cy + headRadius + 20);
      ctx.lineTo(cx - 2 + sway, cy + headRadius + 20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Hair cap
      ctx.beginPath();
      ctx.arc(cx, cy, headRadius + 1, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'curly_afro': {
      // Circular bumps around head
      ctx.beginPath();
      ctx.arc(cx, cy, headRadius + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Individual curl bumps
      ctx.fillStyle = _lightenColor(_hairColor(options), 20);
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        const bx = cx + Math.cos(angle) * (headRadius + 4);
        const by = cy + Math.sin(angle) * (headRadius + 4);
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'short_crop': {
      // Short rectangle cap on top of head
      ctx.beginPath();
      ctx.rect(cx - headRadius - 1, cy - headRadius, headRadius * 2 + 2, headRadius + 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    default: {
      // Simple hair cap
      ctx.beginPath();
      ctx.arc(cx, cy, headRadius + 2, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
};

const _hairColor = (options: CellDrawOptions): string => {
  const colors = ['#4A3320', '#6B4A30', '#D4A86A', '#F0D090', '#222222', '#8B2500'];
  return colors[options.row % colors.length] ?? '#4A3320';
};

// ---------------------------------------------------------------------------
// Torso / armor renderer
// ---------------------------------------------------------------------------

const _drawTorsoCell = (ctx: CanvasRenderingContext2D, options: CellDrawOptions): void => {
  const { shapeType, framePhase, isWalkRow } = options;
  const cx = 32;
  const topY = 28;
  const torsoW = 20;
  const torsoH = 24;
  const sway = isWalkRow ? Math.sin(framePhase * Math.PI * 2) * 2 : 0;
  const x = cx - torsoW / 2 + sway;

  ctx.lineWidth = 1;

  switch (shapeType) {
    case 'chainmail': {
      // Grid pattern — many small rings
      ctx.fillStyle = '#888888';
      ctx.fillRect(x, topY, torsoW, torsoH);
      ctx.strokeStyle = '#666666';
      ctx.strokeRect(x, topY, torsoW, torsoH);

      // Ring pattern dots
      ctx.fillStyle = '#aaaaaa';
      for (let gy = topY + 3; gy < topY + torsoH - 2; gy += 4) {
        for (let gx = x + 3; gx < x + torsoW - 2; gx += 4) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'leather_vest': {
      // Brown cross-hatch pattern
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(x, topY, torsoW, torsoH);
      ctx.strokeStyle = '#5A3E0A';
      ctx.strokeRect(x, topY, torsoW, torsoH);

      // Cross-hatch stitching
      ctx.strokeStyle = '#A67C2E';
      ctx.lineWidth = 0.5;
      for (let lx = x + 2; lx < x + torsoW; lx += 6) {
        ctx.beginPath();
        ctx.moveTo(lx, topY);
        ctx.lineTo(lx - 8, topY + torsoH);
        ctx.stroke();
      }
      for (let lx = x - 6; lx < x + torsoW + 8; lx += 6) {
        ctx.beginPath();
        ctx.moveTo(lx, topY);
        ctx.lineTo(lx + 8, topY + torsoH);
        ctx.stroke();
      }
      break;
    }
    case 'plate_armor': {
      // Thick silver bordered plates
      ctx.fillStyle = '#CCCCCC';
      ctx.fillRect(x, topY, torsoW, torsoH);
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, topY, torsoW, torsoH);

      // Chest plate division line
      ctx.beginPath();
      ctx.moveTo(cx + sway, topY);
      ctx.lineTo(cx + sway, topY + torsoH);
      ctx.strokeStyle = '#999999';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Shoulder pauldrons
      ctx.fillStyle = '#BBBBBB';
      ctx.fillRect(x - 3, topY, 6, 8);
      ctx.fillRect(x + torsoW - 3, topY, 6, 8);
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, topY, 6, 8);
      ctx.strokeRect(x + torsoW - 3, topY, 6, 8);
      break;
    }
    case 'robe': {
      // Flowing cloth — wavy bottom edge
      ctx.fillStyle = '#4444AA';
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x + torsoW, topY);
      // Wavy bottom
      for (let wx = 0; wx <= 4; wx++) {
        const waveX = x + (wx / 4) * torsoW;
        const waveY = topY + torsoH + 10 + Math.sin((wx + framePhase) * Math.PI) * 4;
        ctx.lineTo(waveX, waveY);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#333388';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    default: {
      // Simple rectangle
      ctx.fillStyle = '#8B6914';
      ctx.fillRect(x, topY, torsoW, torsoH);
      ctx.strokeStyle = '#5A3E0A';
      ctx.strokeRect(x, topY, torsoW, torsoH);
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Legs renderer
// ---------------------------------------------------------------------------

const _drawLegsCell = (ctx: CanvasRenderingContext2D, options: CellDrawOptions): void => {
  const { shapeType } = options;
  const cx = 32;
  const topY = 34;
  const legW = 8;
  const legH = 26;

  ctx.lineWidth = 1;

  switch (shapeType) {
    case 'plate_greaves': {
      // Thick silver rectangles on legs
      ctx.fillStyle = '#BBBBBB';
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;

      // Left greave
      ctx.fillRect(cx - legW - 2, topY, legW + 2, legH);
      ctx.strokeRect(cx - legW - 2, topY, legW + 2, legH);

      // Right greave
      ctx.fillRect(cx + 2, topY, legW + 2, legH);
      ctx.strokeRect(cx + 2, topY, legW + 2, legH);

      // Knee guards
      ctx.fillStyle = '#DDDDDD';
      ctx.beginPath();
      ctx.arc(cx - legW / 2 - 1, topY + 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + legW / 2 + 3, topY + 2, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cloth_skirt': {
      // A-line triangular skirt
      ctx.fillStyle = '#7744AA';
      ctx.strokeStyle = '#552288';
      ctx.beginPath();
      ctx.moveTo(cx - legW, topY);
      ctx.lineTo(cx + legW, topY);
      ctx.lineTo(cx + legW + 6, topY + legH);
      ctx.lineTo(cx - legW - 6, topY + legH);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Pleat lines
      ctx.strokeStyle = '#6633AA';
      ctx.lineWidth = 0.5;
      for (let px = -2; px <= 2; px++) {
        ctx.beginPath();
        ctx.moveTo(cx + px * 3, topY);
        ctx.lineTo(cx + px * 4, topY + legH);
        ctx.stroke();
      }
      break;
    }
    case 'tattered_pants': {
      // Jagged bottom edges
      ctx.fillStyle = '#6B4E30';
      ctx.strokeStyle = '#4A3320';

      // Left leg with jagged bottom
      ctx.beginPath();
      ctx.moveTo(cx - legW, topY);
      ctx.lineTo(cx - 1, topY);
      ctx.lineTo(cx - 1, topY + legH - 4);
      // Jagged edge
      for (let j = 0; j < 3; j++) {
        const jx = cx - 1 - j * 3;
        const jy = topY + legH - 4 + (j % 2) * 4;
        ctx.lineTo(jx, jy);
      }
      ctx.lineTo(cx - legW, topY + legH - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Right leg with jagged bottom
      ctx.beginPath();
      ctx.moveTo(cx + 1, topY);
      ctx.lineTo(cx + legW, topY);
      ctx.lineTo(cx + legW, topY + legH - 2);
      for (let j = 0; j < 3; j++) {
        const jx = cx + legW - j * 3;
        const jy = topY + legH - 4 + (j % 2) * 4;
        ctx.lineTo(jx, jy);
      }
      ctx.lineTo(cx + 1, topY + legH - 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Tear holes
      ctx.fillStyle = '#d4a070';
      ctx.beginPath();
      ctx.arc(cx - 4, topY + 10, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 4, topY + 16, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // Simple leg rectangles
      ctx.fillStyle = '#6B4E30';
      ctx.strokeStyle = '#4A3320';
      ctx.fillRect(cx - legW, topY, legW, legH);
      ctx.strokeRect(cx - legW, topY, legW, legH);
      ctx.fillRect(cx + 1, topY, legW, legH);
      ctx.strokeRect(cx + 1, topY, legW, legH);
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Weapon renderer
// ---------------------------------------------------------------------------

const _drawWeaponCell = (ctx: CanvasRenderingContext2D, options: CellDrawOptions): void => {
  const { shapeType, framePhase, isWalkRow } = options;
  const cx = 42; // Offset to right side (weapon hand)
  const cy = 34;
  const swing = isWalkRow ? Math.sin(framePhase * Math.PI * 2) * 6 : 0;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (shapeType) {
    case 'broadsword': {
      // Long vertical blade + cross guard + grip
      const bladeLen = 36;
      const bladeW = 4;

      // Blade
      ctx.fillStyle = '#AAAAAA';
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - bladeW / 2, cy - bladeLen + swing * 0.4);
      ctx.lineTo(cx - 1, cy - bladeLen + 2 + swing * 0.4);
      ctx.lineTo(cx + 1, cy - bladeLen + 2 + swing * 0.4);
      ctx.lineTo(cx + bladeW / 2, cy - bladeLen + swing * 0.4);
      ctx.lineTo(cx + bladeW / 2, cy - bladeLen / 2);
      ctx.lineTo(cx - bladeW / 2, cy - bladeLen / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cross guard
      ctx.fillStyle = '#CCAA00';
      ctx.fillRect(cx - 8, cy - bladeLen / 2 - 2, 16, 4);
      ctx.strokeStyle = '#886600';
      ctx.strokeRect(cx - 8, cy - bladeLen / 2 - 2, 16, 4);

      // Grip
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(cx - 2, cy - bladeLen / 2 + 2, 4, 10);
      ctx.strokeRect(cx - 2, cy - bladeLen / 2 + 2, 4, 10);
      break;
    }
    case 'spear': {
      // Long thin shaft + pointed tip
      const shaftLen = 42;

      ctx.strokeStyle = '#8B6914';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + swing * 0.2, cy - shaftLen + 4);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      // Spearhead
      ctx.fillStyle = '#AAAAAA';
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + swing * 0.2, cy - shaftLen + 4);
      ctx.lineTo(cx - 4 + swing * 0.2, cy - shaftLen + 14);
      ctx.lineTo(cx + swing * 0.2, cy - shaftLen + 10);
      ctx.lineTo(cx + 4 + swing * 0.2, cy - shaftLen + 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'wood_bow': {
      // Curved bow arc + bowstring
      const bowHeight = 34;
      const bowCurve = 10;

      // Bow arc
      ctx.strokeStyle = '#8B6914';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - bowCurve + swing * 0.2, cy - bowHeight / 2);
      ctx.quadraticCurveTo(
        cx + bowCurve + swing * 0.2,
        cy,
        cx - bowCurve + swing * 0.2,
        cy + bowHeight / 2,
      );
      ctx.stroke();

      // Bowstring
      ctx.strokeStyle = '#CCCCCC';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cx - bowCurve + swing * 0.2, cy - bowHeight / 2);
      ctx.lineTo(cx - bowCurve + swing * 0.2, cy + bowHeight / 2);
      ctx.stroke();

      // Arrow nock point
      ctx.beginPath();
      ctx.arc(cx - bowCurve + swing * 0.2, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#FF4444';
      ctx.fill();
      break;
    }
    case 'shield': {
      // Rounded shield on left side
      const sCx = 22;
      const sCy = 34;
      const sR = 14;

      ctx.fillStyle = '#CCCCCC';
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sCx, sCy, sR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Cross emblem
      ctx.strokeStyle = '#AA0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sCx, sCy - sR + 4);
      ctx.lineTo(sCx, sCy + sR - 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sCx - sR + 4, sCy);
      ctx.lineTo(sCx + sR - 4, sCy);
      ctx.stroke();

      // Boss
      ctx.beginPath();
      ctx.arc(sCx, sCy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#888888';
      ctx.fill();
      break;
    }
    default: {
      // Generic small weapon
      ctx.fillStyle = '#888888';
      ctx.fillRect(cx - 2, cy - 18 + swing * 0.3, 4, 20);
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 2, cy - 18 + swing * 0.3, 4, 20);
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Default fallback cell renderer
// ---------------------------------------------------------------------------

const _drawDefaultCell = (ctx: CanvasRenderingContext2D, options: CellDrawOptions): void => {
  const { row } = options;
  const colorIdx = row % 8;
  const tints = [0x4488cc, 0x44cc88, 0xcc8844, 0xcc4488, 0x8844cc, 0x44cc44, 0xcc4444, 0x4444cc];
  const tint = tints[colorIdx] ?? 0x888888;
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;

  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(4, 4, 56, 56);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(4, 4, 56, 56);
};

// ---------------------------------------------------------------------------
// Color utility helpers
// ---------------------------------------------------------------------------

/** Blends a base hex color string with a palette array based on row index. */
const _blendColor = (hex: string, palette: readonly string[], row: number): string => {
  const color = palette[row % palette.length];
  return color ? `#${color}` : hex;
};

/** Lightens a hex color by a percentage. */
const _lightenColor = (hex: string, percent: number): string => {
  const clean = hex.replace('#', '');
  const r = Math.min(255, Number.parseInt(clean.slice(0, 2), 16) + percent);
  const g = Math.min(255, Number.parseInt(clean.slice(2, 4), 16) + percent);
  const b = Math.min(255, Number.parseInt(clean.slice(4, 6), 16) + percent);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

/** LPC standard spritesheet grid layout for TextureManager slicing. */
export const LPC_MOCK_LAYOUT = {
  frameWidth: 64,
  frameHeight: 64,
  columns: 13,
  rows: 21,
} as const;

/**
 * Resolves an LPC asset ID and slot name to a static file URL.
 *
 * Path format: `/assets/spritesheets/{slot}_{assetId}.png`
 *
 * The caller is responsible for loading the texture via PixiJS Assets
 * or a fetch-based loader. This function only computes the URL string.
 *
 * @param slot - LPC layer slot name (e.g. 'body', 'hair').
 * @param assetId - Numeric grayscale asset ID (e.g. '101').
 * @returns The full static file URL path.
 */
export const getLpcAssetPath = (slot: string, assetId: string): string => {
  const prefix = SLOT_FILE_PREFIX[slot] ?? slot;
  return `${LPC_ASSET_BASE_PATH}/${prefix}_${assetId}.png`;
};

// ---------------------------------------------------------------------------
// Placeholder generation
// ---------------------------------------------------------------------------

/**
 * Generates a high-visibility 64×64 placeholder Canvas element containing
 * the slot name and asset ID. Used as a fallback when the actual spritesheet
 * file cannot be resolved or loaded.
 *
 * Colors the background magenta (#ff00ff) as the standard "missing asset"
 * signal, with white text overlay showing the slot+asset identifier for
 * debugging.
 *
 * @param slot - LPC layer slot name.
 * @param assetId - Numeric asset ID string.
 * @returns An HTMLCanvasElement (64×64) with placeholder diagnostic content.
 */
export const createPlaceholderCanvas = (slot: string, assetId: string): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = LPC_FRAME_SIZE;
  canvas.height = LPC_FRAME_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    logger.error('lpcAssetMapper.noContext', { slot, assetId });
    return canvas;
  }

  // Magenta fill — standard "missing asset" signal
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, LPC_FRAME_SIZE, LPC_FRAME_SIZE);

  // Slot name text overlay
  ctx.fillStyle = '#ffffff';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = [slot, `#${assetId}`];
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i] ?? '', LPC_FRAME_SIZE / 2, LPC_FRAME_SIZE / 2 - 6 + i * 10);
  }

  return canvas;
};

/**
 * Creates a magenta placeholder PixiJS Texture (64×64) for a missing LPC asset.
 *
 * Uses Canvas2D to render the placeholder and converts it to a PixiJS Texture
 * via `Texture.from(canvas)`. This ensures the texture pipeline operates
 * normally even when file assets are unavailable — sprites appear as magenta
 * blocks with slot name labels instead of throwing errors.
 *
 * @param slot - LPC layer slot name.
 * @param assetId - Numeric asset ID string.
 * @returns A promise resolving to a PixiJS Texture (async for future
 *   compatibility with file-based loaders).
 */
export const createPlaceholderTexture = async (slot: string, assetId: string) => {
  // Dynamic import — only available in browser context (PixiJS)
  const { Texture } = await import('pixi.js');

  const canvas = createPlaceholderCanvas(slot, assetId);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';

  return texture;
};

// ---------------------------------------------------------------------------
// Asset availability check
// ---------------------------------------------------------------------------

/** In-memory cache of path → exists result to avoid repeated HEAD requests. */
const _assetExistsCache = new Map<string, boolean>();

/**
 * Checks whether an LPC spritesheet file exists by issuing a HEAD request
 * to the resolved static path.
 *
 * Results are cached in-memory for the lifetime of the page session.
 * A failed fetch (network error, 404) is cached as false so the same
 * asset is never re-fetched in the same session.
 *
 * @param slot - LPC layer slot name.
 * @param assetId - Numeric asset ID string.
 * @returns True if the asset file exists (HTTP 200).
 */
export const checkAssetExists = async (slot: string, assetId: string): Promise<boolean> => {
  const path = getLpcAssetPath(slot, assetId);
  const cached = _assetExistsCache.get(path);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await fetch(path, { method: 'HEAD' });
    const exists = response.ok;
    _assetExistsCache.set(path, exists);
    return exists;
  } catch {
    _assetExistsCache.set(path, false);
    return false;
  }
};

// ---------------------------------------------------------------------------
// Batch asset path map generation
// ---------------------------------------------------------------------------

/**
 * Generates a lookup map from slot name to array of variant asset paths
 * for a given slot definition.
 *
 * Useful for pre-warming the asset cache or generating dropdown option lists
 * that include path previews.
 *
 * @param slot - The LPC slot name.
 * @param assetIds - Array of numeric asset ID strings.
 * @returns A record mapping asset IDs to their resolved file paths.
 */
export const buildAssetPathMap = (
  slot: string,
  assetIds: readonly string[],
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const assetId of assetIds) {
    result[assetId] = getLpcAssetPath(slot, assetId);
  }

  return result;
};

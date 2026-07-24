// apps/frontend/site/src/lib/components/sections/hero_d20.ts
/**
 * PixiJS v8 D20 physics simulation for the Hero section.
 * Features: 2.5D icosahedron projection, physics-driven roll on click/drag,
 * particle spell effects, ambient magic dust, dynamic lighting.
 */
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

/* ── Types ── */

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  alpha: number;
};

type D20State = {
  rotation: number;
  rotationSpeed: number;
  verticalOffset: number;
  velocityY: number;
  isRolling: boolean;
  rollTimer: number;
  result: number | null;
};

/* ── Constants ── */

const COLORS = {
  rune: 0x8b5cf6,
  runeGlow: 0xa78bfa,
  ember: 0xf59e0b,
  magicBlue: 0x6366f1,
  goldSpark: 0xfbbf24,
  shadow: 0x1e1b4b,
} as const;

const PARTICLE_COUNT = 120;
const AMBIENT_PARTICLE_COUNT = 30;
const GRAVITY = 0.6;
const BOUNCE_DAMPING = 0.55;
const ROLL_IMPULSE = 18;

/* ── D20 Face rendering ── */

/** Draw a 2.5D d20 as a collection of triangular faces */
const drawD20 = (g: Graphics, rotation: number, scale: number, offsetY: number): void => {
  g.clear();

  const size = 48 * scale;
  const cx = 0;
  const cy = offsetY;

  // Face points for an icosahedron projection (simplified 2.5D)
  // Top point
  const topY = cy - size * 1.3;
  // Upper ring (5 points)
  const upperRing = Array.from({ length: 5 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2 + rotation;
    return { x: cx + Math.cos(angle) * size * 0.7, y: cy - size * 0.45 };
  });
  // Equatorial ring (5 points, offset)
  const eqRing = Array.from({ length: 5 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 5 + Math.PI / 5 - Math.PI / 2 + rotation;
    return { x: cx + Math.cos(angle) * size, y: cy + size * 0.05 };
  });
  // Lower ring (5 points)
  const lowerRing = Array.from({ length: 5 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2 + rotation;
    return { x: cx + Math.cos(angle) * size * 0.7, y: cy + size * 0.55 };
  });
  // Bottom point
  const bottomY = cy + size * 1.3;

  // Draw top cap faces (top → upper ring)
  for (let i = 0; i < 5; i++) {
    const next = (i + 1) % 5;
    const shade = 0.45 + 0.35 * Math.sin(rotation * 3 + i);
    const faceColor = lerpColor(COLORS.rune, COLORS.shadow, shade);

    g.poly([cx, topY, upperRing[i]?.x, upperRing[i]?.y, upperRing[next]?.x, upperRing[next]?.y]);
    g.fill({ color: faceColor, alpha: 0.85 });
    g.stroke({ color: COLORS.runeGlow, alpha: 0.4, width: 0.8 });
  }

  // Draw upper belt faces (upper ring → equatorial ring)
  for (let i = 0; i < 5; i++) {
    const next = (i + 1) % 5;
    const prevEq = (i + 4) % 5;
    const shade = 0.4 + 0.4 * Math.sin(rotation * 2.5 + i + 1);
    const faceColor = lerpColor(COLORS.rune, COLORS.ember, shade);

    // Left face
    g.poly([
      upperRing[i]?.x,
      upperRing[i]?.y,
      eqRing[prevEq]?.x,
      eqRing[prevEq]?.y,
      eqRing[i]?.x,
      eqRing[i]?.y,
    ]);
    g.fill({ color: faceColor, alpha: 0.8 });
    g.stroke({ color: COLORS.runeGlow, alpha: 0.35, width: 0.8 });

    // Right face
    g.poly([
      upperRing[i]?.x,
      upperRing[i]?.y,
      eqRing[i]?.x,
      eqRing[i]?.y,
      upperRing[next]?.x,
      upperRing[next]?.y,
    ]);
    g.fill({ color: lerpColor(faceColor, COLORS.shadow, 0.2), alpha: 0.8 });
    g.stroke({ color: COLORS.runeGlow, alpha: 0.35, width: 0.8 });
  }

  // Draw lower belt faces (equatorial ring → lower ring)
  for (let i = 0; i < 5; i++) {
    const next = (i + 1) % 5;
    const shade = 0.4 + 0.4 * Math.sin(rotation * 2.5 + i + 2);
    const faceColor = lerpColor(COLORS.rune, COLORS.magicBlue, shade);

    g.poly([
      eqRing[i]?.x,
      eqRing[i]?.y,
      lowerRing[i]?.x,
      lowerRing[i]?.y,
      lowerRing[next]?.x,
      lowerRing[next]?.y,
    ]);
    g.fill({ color: faceColor, alpha: 0.8 });
    g.stroke({ color: COLORS.runeGlow, alpha: 0.35, width: 0.8 });

    g.poly([
      eqRing[i]?.x,
      eqRing[i]?.y,
      lowerRing[next]?.x,
      lowerRing[next]?.y,
      eqRing[next]?.x,
      eqRing[next]?.y,
    ]);
    g.fill({ color: lerpColor(faceColor, COLORS.shadow, 0.15), alpha: 0.8 });
    g.stroke({ color: COLORS.runeGlow, alpha: 0.35, width: 0.8 });
  }

  // Draw bottom cap faces (lower ring → bottom)
  for (let i = 0; i < 5; i++) {
    const next = (i + 1) % 5;
    const shade = 0.5 + 0.3 * Math.sin(rotation * 3 + i + 1);
    const faceColor = lerpColor(COLORS.rune, COLORS.shadow, shade);

    g.poly([cx, bottomY, lowerRing[next]?.x, lowerRing[next]?.y, lowerRing[i]?.x, lowerRing[i]?.y]);
    g.fill({ color: faceColor, alpha: 0.85 });
    g.stroke({ color: COLORS.runeGlow, alpha: 0.4, width: 0.8 });
  }

  // Draw result number on top face if rolled
  // (simplified — shows as overlay)
};

/* ── Utility ── */

const lerpColor = (c1: number, c2: number, t: number): number => {
  const r1 = (c1 >> 16) & 0xff;
  const g1 = (c1 >> 8) & 0xff;
  const b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff;
  const g2 = (c2 >> 8) & 0xff;
  const b2 = c2 & 0xff;

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return (r << 16) | (g << 8) | b;
};

const randomBetween = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

/* ── Particle System ── */

const createParticles = (count: number, centerX: number, centerY: number): Particle[] => {
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(2, 8);
    const life = randomBetween(30, 80);

    return {
      x: centerX + randomBetween(-15, 15),
      y: centerY + randomBetween(-15, 15),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - randomBetween(0, 4),
      life,
      maxLife: life,
      size: randomBetween(1.5, 4),
      color:
        [COLORS.rune, COLORS.ember, COLORS.magicBlue, COLORS.goldSpark][
          Math.floor(Math.random() * 4)
        ] ?? COLORS.rune,
      alpha: 1,
    };
  });
};

/* ── Main Initialization ── */

export const initHeroD20 = async (containerId: string): Promise<() => void> => {
  const container = document.getElementById(containerId);
  if (!container) {
    return () => {};
  }

  const app = new Application();

  await app.init({
    resizeTo: container,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  container.appendChild(app.canvas);

  const { width, height } = app.screen;

  // ── Layers ──
  const ambientLayer = new Container();
  const d20Layer = new Container();
  const particleLayer = new Container();
  const resultLayer = new Container();

  app.stage.addChild(ambientLayer);
  app.stage.addChild(d20Layer);
  app.stage.addChild(particleLayer);
  app.stage.addChild(resultLayer);

  // ── D20 State ──
  const state: D20State = {
    rotation: 0,
    rotationSpeed: 0.3,
    verticalOffset: 0,
    velocityY: 0,
    isRolling: false,
    rollTimer: 0,
    result: null,
  };

  // ── D20 Graphics ──
  const d20Gfx = new Graphics();
  const centerX = width / 2;
  const centerY = height / 2;
  d20Layer.addChild(d20Gfx);

  // ── Result Text ──
  const resultText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'Instrument Serif, Georgia, serif',
      fontSize: 28,
      fill: '#a78bfa',
      align: 'center',
    }),
  });
  resultText.anchor.set(0.5);
  resultText.x = centerX;
  resultText.y = centerY - 100;
  resultText.alpha = 0;
  resultLayer.addChild(resultText);

  // ── Snippet Text (narrative encounter) ──
  const snippetText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'Inter, sans-serif',
      fontSize: 13,
      fill: '#c4b5fd',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 320,
    }),
  });
  snippetText.anchor.set(0.5);
  snippetText.x = centerX;
  snippetText.y = centerY - 55;
  snippetText.alpha = 0;
  resultLayer.addChild(snippetText);

  // ── Ambient particles ──
  const ambientParticles: Particle[] = Array.from({ length: AMBIENT_PARTICLE_COUNT }, () => ({
    x: randomBetween(-50, width + 50),
    y: randomBetween(-50, height + 50),
    vx: randomBetween(-0.2, 0.2),
    vy: randomBetween(-0.5, -0.1),
    life: 9999,
    maxLife: 9999,
    size: randomBetween(1, 2.5),
    color: COLORS.runeGlow,
    alpha: randomBetween(0.15, 0.4),
  }));

  // ── Burst particles (triggered on roll) ──
  let burstParticles: Particle[] = [];

  // ── Narrative snippets ──
  const snippets = [
    'A cloaked figure gestures toward the ancient crypt. "The runes awaken," she whispers.',
    'You sense a surge of arcane energy. The ground trembles beneath your feet.',
    '"Roll for initiative," the Dungeon Master intones. The goblins snarl in the shadows.',
    "A shimmering portal opens before you. Through it: a dragon's hoard, glittering.",
    'The townsfolk gasp. "The prophecy speaks of one who carries that mark..."',
    'Critical hit! Your strike cleaves through the darkness with blinding light.',
    'An ancient mechanism clicks. Hidden doors grind open, revealing a forgotten chamber.',
    '"Nat 20!" The table erupts. Fate itself bends to your will.',
    'The forest whispers secrets. Every leaf a page from a story not yet written.',
    'A rival adventuring party eyes you warily. Allies or adversaries?',
  ];

  let currentSnippetIndex = 0;

  // ── Glow overlay ──
  const glowGfx = new Graphics();
  glowGfx.circle(centerX, centerY, 70);
  glowGfx.fill({ color: COLORS.rune, alpha: 0.06 });
  d20Layer.addChild(glowGfx);

  // ── Interaction ──
  let isDragging = false;
  let dragStartY = 0;

  const triggerRoll = (): void => {
    if (state.isRolling) {
      return;
    }

    state.isRolling = true;
    state.rollTimer = 0;
    state.velocityY = -ROLL_IMPULSE * (0.8 + Math.random() * 0.4);
    state.rotationSpeed = (Math.random() - 0.5) * 0.8;
    state.result = Math.floor(Math.random() * 20) + 1;

    // Spawn burst particles
    burstParticles = createParticles(PARTICLE_COUNT, centerX, centerY);

    // Narrative snippet
    currentSnippetIndex = (currentSnippetIndex + 1) % snippets.length;
    const snippet = snippets[currentSnippetIndex] ?? snippets[0] ?? '';
    snippetText.text = snippet;
    snippetText.alpha = 0;

    // Dispatch roll event for DM terminal integration
    const isNat1 = state.result === 1;
    const isNat20 = state.result === 20;
    document.dispatchEvent(
      new CustomEvent('d20:roll', {
        detail: { result: state.result, isNat1, isNat20, snippet },
      }),
    );
  };

  // Listen for external roll triggers (from DM terminal)
  document.addEventListener('d20:trigger-roll', () => {
    triggerRoll();
  });

  // Click to roll
  app.canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - centerX;
    const dy = y - centerY;

    if (Math.sqrt(dx * dx + dy * dy) < 80) {
      triggerRoll();
    }
  });

  // Pointer events for drag
  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - centerX;
    const dy = y - centerY;

    if (Math.sqrt(dx * dx + dy * dy) < 80) {
      isDragging = true;
      dragStartY = e.clientY;
    }
  });

  globalThis.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) {
      return;
    }
    const delta = dragStartY - e.clientY;
    if (delta > 30) {
      triggerRoll();
      isDragging = false;
    }
  });

  globalThis.addEventListener('pointerup', () => {
    isDragging = false;
  });

  // ── Ticker ──
  app.ticker.add(() => {
    const dt = app.ticker.deltaTime;

    // ── Ambient particles ──
    const ambientGfx = new Graphics();
    for (const p of ambientParticles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -20) {
        p.y = height + 20;
        p.x = randomBetween(0, width);
      }
      if (p.x < -20) {
        p.x = width + 20;
      }
      if (p.x > width + 20) {
        p.x = -20;
      }
      ambientGfx.circle(p.x, p.y, p.size);
      ambientGfx.fill({ color: p.color, alpha: p.alpha });
    }
    ambientLayer.removeChildren();
    ambientLayer.addChild(ambientGfx);

    // ── Burst particles ──
    const burstGfx = new Graphics();
    burstParticles = burstParticles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.life--;
      p.alpha = Math.max(0, p.life / p.maxLife);

      if (p.life <= 0) {
        return false;
      }

      burstGfx.circle(p.x, p.y, p.size * p.alpha);
      burstGfx.fill({ color: p.color, alpha: p.alpha * 0.8 });
      return true;
    });
    particleLayer.removeChildren();
    particleLayer.addChild(burstGfx);

    // ── D20 Physics ──
    if (state.isRolling) {
      state.verticalOffset += state.velocityY;
      state.velocityY += GRAVITY;
      state.rotation += state.rotationSpeed * 0.15;

      // Bounce
      if (state.verticalOffset >= 0 && state.velocityY > 0) {
        state.verticalOffset = 0;
        state.velocityY *= -BOUNCE_DAMPING;
        state.rotationSpeed *= BOUNCE_DAMPING;

        if (Math.abs(state.velocityY) < 0.5) {
          state.velocityY = 0;
          state.verticalOffset = 0;
        }
      }

      state.rollTimer += dt;

      // Settle
      if (Math.abs(state.velocityY) < 0.01 && state.verticalOffset === 0 && state.rollTimer > 80) {
        state.isRolling = false;
        state.rotationSpeed = 0;

        // Show result
        resultText.text = `${state.result}`;
        resultText.alpha = 0;
      }
    } else {
      // Idle float
      state.rotation += state.rotationSpeed * 0.01;
    }

    // ── Result fade ──
    if (!state.isRolling && state.result !== null && resultText.alpha < 1) {
      resultText.alpha = Math.min(1, resultText.alpha + 0.02);
      snippetText.alpha = Math.min(1, snippetText.alpha + 0.015);
    }

    if (state.isRolling) {
      resultText.alpha = Math.max(0, resultText.alpha - 0.05);
      snippetText.alpha = Math.max(0, snippetText.alpha - 0.03);
    }

    // ── Render D20 ──
    const scale = 1 + 0.03 * Math.sin(state.rotation * 0.3);
    const bounceScale = state.isRolling ? 1 - Math.abs(state.verticalOffset) * 0.008 : 1;

    d20Gfx.clear();
    drawD20(d20Gfx, state.rotation, scale * bounceScale, state.verticalOffset);

    // ── Glow pulse ──
    const glowAlpha = state.isRolling
      ? 0.15 + Math.abs(Math.sin(state.rollTimer * 0.3)) * 0.1
      : 0.06 + 0.02 * Math.sin(Date.now() * 0.002);

    glowGfx.clear();
    glowGfx.circle(centerX, centerY, 75);
    glowGfx.fill({ color: state.isRolling ? COLORS.ember : COLORS.rune, alpha: glowAlpha });

    // ── Cursor style ──
    app.canvas.style.cursor = 'grab';
  });

  // Cleanup function
  return () => {
    app.ticker.stop();
    app.destroy(true, { children: true });
  };
};

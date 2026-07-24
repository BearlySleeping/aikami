// apps/frontend/site/src/lib/components/sections/concept_magnets_canvas.ts
/**
 * Spatial Concept Magnets — draggable faction/thematic cards that
 * realign based on semantic affinity when released.
 */
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

/* ── Types ── */

type Magnet = {
  id: string;
  label: string;
  description: string;
  affinity: { x: number; y: number }; // semantic position in affinity space
  x: number;
  y: number;
  radius: number;
  color: number;
  isDragging: boolean;
};

/* ── Colors ── */

const FACTION_COLORS = {
  mages: 0x6366f1,
  warriors: 0xf59e0b,
  thieves: 0x10b981,
  clerics: 0xec4899,
  druids: 0x22d3ee,
  necromancers: 0xa855f7,
  merchants: 0xfbbf24,
  rangers: 0x34d399,
};

/* ── Magnets data ── */

const magnets: Magnet[] = [
  {
    id: 'mages',
    label: 'Arcane Circle',
    description: 'Seekers of forbidden knowledge. Neutral to most, feared by the devout.',
    affinity: { x: 0.25, y: 0.2 },
    x: 0,
    y: 0,
    radius: 44,
    color: FACTION_COLORS.mages,
    isDragging: false,
  },
  {
    id: 'warriors',
    label: 'Iron Legion',
    description: 'Disciplined soldiers. Respect strength. Distrust magic.',
    affinity: { x: 0.6, y: 0.55 },
    x: 0,
    y: 0,
    radius: 42,
    color: FACTION_COLORS.warriors,
    isDragging: false,
  },
  {
    id: 'thieves',
    label: 'Shadow Guild',
    description: "Information brokers. Everyone's ally — for a price.",
    affinity: { x: 0.55, y: 0.25 },
    x: 0,
    y: 0,
    radius: 38,
    color: FACTION_COLORS.thieves,
    isDragging: false,
  },
  {
    id: 'clerics',
    label: 'Divine Order',
    description: 'Holy warriors of light. Sworn enemies of the undead.',
    affinity: { x: 0.7, y: 0.15 },
    x: 0,
    y: 0,
    radius: 40,
    color: FACTION_COLORS.clerics,
    isDragging: false,
  },
  {
    id: 'druids',
    label: 'Wildwardens',
    description: 'Guardians of the old woods. Distrust civilization.',
    affinity: { x: 0.2, y: 0.65 },
    x: 0,
    y: 0,
    radius: 38,
    color: FACTION_COLORS.druids,
    isDragging: false,
  },
  {
    id: 'necromancers',
    label: 'Bone Court',
    description: 'Masters of death. Hated by the Order, tolerated by none.',
    affinity: { x: 0.85, y: 0.8 },
    x: 0,
    y: 0,
    radius: 42,
    color: FACTION_COLORS.necromancers,
    isDragging: false,
  },
  {
    id: 'merchants',
    label: 'Trade Consortium',
    description: 'Gold transcends factions. Neutral ground for all.',
    affinity: { x: 0.5, y: 0.45 },
    x: 0,
    y: 0,
    radius: 36,
    color: FACTION_COLORS.merchants,
    isDragging: false,
  },
  {
    id: 'rangers',
    label: 'Verdant Path',
    description: 'Wanderers between worlds. Allied with Wardens, tolerated by the Guild.',
    affinity: { x: 0.35, y: 0.5 },
    x: 0,
    y: 0,
    radius: 36,
    color: FACTION_COLORS.rangers,
    isDragging: false,
  },
];

/* ── Runic sigil geometry — draws a faction-specific runic glyph ── */

const SIGIL_PATTERNS: Record<
  string,
  (g: Graphics, cx: number, cy: number, r: number, color: number) => void
> = {
  mages: (g, cx, cy, r, color) => {
    // Eye / diamond rune
    g.poly([cx, cy - r * 0.7, cx + r * 0.5, cy, cx, cy + r * 0.7, cx - r * 0.5, cy]);
    g.fill({ color, alpha: 0.4 });
    g.circle(cx, cy, r * 0.15);
    g.fill({ color: 0xffffff, alpha: 0.8 });
  },
  warriors: (g, cx, cy, r, color) => {
    // Crossed blades
    g.moveTo(cx - r * 0.6, cy - r * 0.5);
    g.lineTo(cx + r * 0.6, cy + r * 0.5);
    g.moveTo(cx + r * 0.6, cy - r * 0.5);
    g.lineTo(cx - r * 0.6, cy + r * 0.5);
    g.stroke({ color, alpha: 0.5, width: 2 });
  },
  thieves: (g, cx, cy, r, color) => {
    // Three interlocking rings
    for (let i = 0; i < 3; i++) {
      const angle = (Math.PI * 2 * i) / 3;
      const rx = cx + Math.cos(angle) * r * 0.25;
      const ry = cy + Math.sin(angle) * r * 0.25;
      g.circle(rx, ry, r * 0.35);
      g.stroke({ color, alpha: 0.5, width: 1.2 });
    }
  },
  clerics: (g, cx, cy, r, color) => {
    // Radiant cross
    g.moveTo(cx, cy - r * 0.65);
    g.lineTo(cx, cy + r * 0.65);
    g.moveTo(cx - r * 0.65, cy);
    g.lineTo(cx + r * 0.65, cy);
    g.stroke({ color, alpha: 0.5, width: 2 });
    g.circle(cx, cy, r * 0.2);
    g.fill({ color: 0xffffff, alpha: 0.7 });
  },
  druids: (g, cx, cy, r, color) => {
    // Leaf / tree shape
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const px = cx + Math.cos(angle) * r * 0.7;
      const py = cy + Math.sin(angle) * r * 0.7;
      g.circle(px, py, r * 0.2);
      g.fill({ color, alpha: 0.4 });
    }
    g.circle(cx, cy, r * 0.22);
    g.fill({ color, alpha: 0.6 });
  },
  necromancers: (g, cx, cy, r, color) => {
    // Skull-like: inverted triangle with dots
    g.poly([cx, cy + r * 0.6, cx - r * 0.55, cy - r * 0.45, cx + r * 0.55, cy - r * 0.45]);
    g.stroke({ color, alpha: 0.5, width: 1.5 });
    g.circle(cx - r * 0.15, cy - r * 0.05, r * 0.12);
    g.fill({ color: 0xffffff, alpha: 0.5 });
    g.circle(cx + r * 0.15, cy - r * 0.05, r * 0.12);
    g.fill({ color: 0xffffff, alpha: 0.5 });
  },
  merchants: (g, cx, cy, r, color) => {
    // Scales / hexagon
    const hex = Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 6 - Math.PI / 6;
      return { x: cx + Math.cos(angle) * r * 0.5, y: cy + Math.sin(angle) * r * 0.5 };
    });
    g.poly(hex.flatMap((p) => [p.x, p.y]));
    g.stroke({ color, alpha: 0.5, width: 1.5 });
  },
  rangers: (g, cx, cy, r, color) => {
    // Arrowhead
    g.poly([
      cx,
      cy - r * 0.6,
      cx + r * 0.5,
      cy + r * 0.3,
      cx,
      cy + r * 0.1,
      cx - r * 0.5,
      cy + r * 0.3,
    ]);
    g.stroke({ color, alpha: 0.5, width: 1.5 });
    g.moveTo(cx, cy + r * 0.3);
    g.lineTo(cx, cy + r * 0.65);
    g.stroke({ color, alpha: 0.4, width: 1 });
  },
};

/* ── Init ── */

export const initConceptMagnets = async (containerId: string): Promise<() => void> => {
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
  const padding = 60;

  // Init positions randomly but within bounds
  for (const m of magnets) {
    m.x = padding + Math.random() * (width - padding * 2);
    m.y = padding + Math.random() * (height - padding * 2);
  }

  const magnetLayer = new Container();
  const connectionLayer = new Container();
  const trailLayer = new Container();
  const infoLayer = new Container();

  app.stage.addChild(connectionLayer);
  app.stage.addChild(trailLayer);
  app.stage.addChild(magnetLayer);
  app.stage.addChild(infoLayer);

  // Info panel
  const infoBg = new Graphics();
  infoLayer.addChild(infoBg);

  const infoTitle = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      fill: '#a78bfa',
      letterSpacing: 2,
      fontWeight: 'bold',
    }),
  });
  infoTitle.x = 16;
  infoTitle.y = 12;
  infoLayer.addChild(infoTitle);

  const infoDesc = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'Inter, sans-serif',
      fontSize: 11,
      fill: '#c4b5fd',
      wordWrap: true,
      wordWrapWidth: 240,
    }),
  });
  infoDesc.x = 16;
  infoDesc.y = 30;
  infoLayer.addChild(infoDesc);

  infoLayer.alpha = 0;

  let hoveredId: string | null = null;

  // Axis labels
  const axisStyle = new TextStyle({
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 9,
    fill: '#6b7280',
    letterSpacing: 2,
  });

  const xAxisLabel = new Text({ text: 'CHAOS ← → ORDER', style: axisStyle });
  xAxisLabel.anchor.set(0.5);
  xAxisLabel.x = width / 2;
  xAxisLabel.y = height - 16;
  app.stage.addChild(xAxisLabel);

  const yAxisLabel = new Text({ text: 'NATURE', style: axisStyle });
  yAxisLabel.anchor.set(0.5);
  yAxisLabel.x = 14;
  yAxisLabel.y = height / 2;
  yAxisLabel.angle = -90;
  app.stage.addChild(yAxisLabel);

  const yAxisLabel2 = new Text({ text: 'ARCANE', style: axisStyle });
  yAxisLabel2.anchor.set(0.5);
  yAxisLabel2.x = width - 14;
  yAxisLabel2.y = height / 2;
  yAxisLabel2.angle = 90;
  app.stage.addChild(yAxisLabel2);

  // Draw connections based on affinity proximity
  const drawConnections = () => {
    const g = new Graphics();

    for (let i = 0; i < magnets.length; i++) {
      for (let j = i + 1; j < magnets.length; j++) {
        const a = magnets[i];
        const b = magnets[j];
        if (!a || !b) {
          continue;
        }

        const adx = a.affinity.x - b.affinity.x;
        const ady = a.affinity.y - b.affinity.y;
        const affinityDist = Math.sqrt(adx * adx + ady * ady);

        if (affinityDist < 0.35) {
          const alpha = Math.max(0.05, ((0.35 - affinityDist) / 0.35) * 0.35);
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke({ color: 0x8b5cf6, alpha, width: 0.8 });
        }
      }
    }

    connectionLayer.removeChildren();
    connectionLayer.addChild(g);
  };

  drawConnections();

  // ── Particle trail system ──
  const trailParticles: {
    x: number;
    y: number;
    life: number;
    color: number;
    size: number;
    magnetId: string;
  }[] = [];

  // Render magnets
  const renderMagnets = () => {
    const g = new Graphics();
    const labels: Text[] = [];

    for (const m of magnets) {
      const isHovered = hoveredId === m.id;
      const pulse = 0.85 + 0.15 * Math.sin(Date.now() * 0.003 + m.radius);

      // ── Outer ambient halo (pulse ring) ──
      const haloRadius = m.radius + 10 + (isHovered ? 6 : 0);
      g.circle(m.x, m.y, haloRadius);
      g.fill({ color: m.color, alpha: 0.06 * pulse });
      g.circle(m.x, m.y, haloRadius);
      g.stroke({ color: m.color, alpha: 0.2 * pulse, width: 1 });

      // ── Secondary glow ring ──
      g.circle(m.x, m.y, m.radius + 2);
      g.fill({ color: m.color, alpha: 0.12 * pulse });

      // ── Main orb body (runic) ──
      const bodyGfx = new Graphics();

      // Outer runic ring — segmented arcs
      const segments = 8;
      for (let i = 0; i < segments; i++) {
        const startAngle = (Math.PI * 2 * i) / segments + Date.now() * 0.0005;
        const endAngle = startAngle + (Math.PI / segments) * 0.7;
        bodyGfx.arc(m.x, m.y, m.radius + 2, startAngle, endAngle);
        bodyGfx.stroke({ color: m.color, alpha: 0.7 * pulse, width: 1.8 });
      }

      // Inner fill with radial gradient simulation
      bodyGfx.circle(m.x, m.y, m.radius - 1);
      bodyGfx.fill({ color: m.color, alpha: 0.35 });

      // Core bright center
      bodyGfx.circle(m.x, m.y, m.radius * 0.4);
      bodyGfx.fill({ color: m.color, alpha: 0.55 });

      // Runic sigil
      const sigilFn = SIGIL_PATTERNS[m.id];
      if (sigilFn) {
        sigilFn(bodyGfx, m.x, m.y, m.radius, m.color);
      }

      magnetLayer.removeChildren();
      magnetLayer.addChild(bodyGfx);

      // Highlight ring
      if (isHovered) {
        g.circle(m.x, m.y, m.radius + 6);
        g.stroke({ color: 0xffffff, alpha: 0.6, width: 2 });

        // Crosshair glow
        g.moveTo(m.x - m.radius - 10, m.y);
        g.lineTo(m.x - m.radius, m.y);
        g.moveTo(m.x + m.radius, m.y);
        g.lineTo(m.x + m.radius + 10, m.y);
        g.moveTo(m.x, m.y - m.radius - 10);
        g.lineTo(m.x, m.y - m.radius);
        g.moveTo(m.x, m.y + m.radius);
        g.lineTo(m.x, m.y + m.radius + 10);
        g.stroke({ color: 0xffffff, alpha: 0.3, width: 1 });
      }

      // ── Drop particle trail ──
      if (m.isDragging || Math.random() < 0.3) {
        trailParticles.push({
          x: m.x + (Math.random() - 0.5) * 10,
          y: m.y + (Math.random() - 0.5) * 10,
          life: 30 + Math.random() * 20,
          color: m.color,
          size: 1 + Math.random() * 2.5,
          magnetId: m.id,
        });
        // Cap trail length
        if (trailParticles.length > 120) {
          trailParticles.splice(0, 20);
        }
      }

      // ── Label ──
      const lbl = new Text({
        text: m.label,
        style: new TextStyle({
          fontFamily: 'Inter, sans-serif',
          fontSize: 10,
          fill: '#e2e8f0',
          align: 'center',
          fontWeight: isHovered ? 'bold' : 'normal',
        }),
      });
      lbl.anchor.set(0.5);
      lbl.x = m.x;
      lbl.y = m.y + m.radius + 16;
      labels.push(lbl);
    }

    magnetLayer.addChild(g);
    for (const lbl of labels) {
      magnetLayer.addChild(lbl);
    }
  };

  renderMagnets();

  // Interaction
  let dragTarget: Magnet | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const getMagnetAt = (mx: number, my: number): Magnet | null => {
    for (const m of magnets) {
      const dx = mx - m.x;
      const dy = my - m.y;
      if (Math.sqrt(dx * dx + dy * dy) < m.radius + 6) {
        return m;
      }
    }
    return null;
  };

  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const target = getMagnetAt(mx, my);
    if (target) {
      dragTarget = target;
      dragTarget.isDragging = true;
      dragOffsetX = target.x - mx;
      dragOffsetY = target.y - my;
      app.canvas.style.cursor = 'grabbing';
    }
  });

  globalThis.addEventListener('pointermove', (e: PointerEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (dragTarget?.isDragging) {
      dragTarget.x = Math.max(padding, Math.min(width - padding, mx + dragOffsetX));
      dragTarget.y = Math.max(padding, Math.min(height - padding, my + dragOffsetY));
      renderMagnets();
      drawConnections();
      infoLayer.alpha = 0;
      hoveredId = null;
      return;
    }

    const hovered = getMagnetAt(mx, my);
    if (hovered && hoveredId !== hovered.id) {
      hoveredId = hovered.id;
      renderMagnets();

      // Show info
      infoBg.clear();
      infoBg.roundRect(0, 0, 260, 72, 8);
      infoBg.fill({ color: 0x1a102a, alpha: 0.95 });
      infoBg.stroke({ color: hovered.color, alpha: 0.5, width: 1 });

      infoTitle.text = hovered.label.toUpperCase();
      infoDesc.text = hovered.description;
      infoBg.x = Math.min(Math.max(hovered.x + hovered.radius + 14, 10), width - 270);
      infoBg.y = Math.min(Math.max(hovered.y - 36, 10), height - 82);
      infoTitle.x = infoBg.x + 16;
      infoTitle.y = infoBg.y + 12;
      infoDesc.x = infoBg.x + 16;
      infoDesc.y = infoBg.y + 30;
      infoLayer.alpha = 1;

      app.canvas.style.cursor = hovered ? 'grab' : 'default';
    } else if (!hovered && hoveredId !== null) {
      hoveredId = null;
      renderMagnets();
      infoLayer.alpha = 0;
      app.canvas.style.cursor = 'default';
    }
  });

  globalThis.addEventListener('pointerup', () => {
    if (dragTarget) {
      dragTarget.isDragging = false;

      // Snap toward affinity position with smooth lerp
      const targetX = padding + dragTarget.affinity.x * (width - padding * 2);
      const targetY = padding + dragTarget.affinity.y * (height - padding * 2);

      // Quick lerp snap
      dragTarget.x += (targetX - dragTarget.x) * 0.7;
      dragTarget.y += (targetY - dragTarget.y) * 0.7;

      dragTarget = null;
      app.canvas.style.cursor = 'default';
      renderMagnets();
      drawConnections();
    }
  });

  // Ticker for ambient float + trail particles
  app.ticker.add(() => {
    // ── Trail particles ──
    const trailGfx = new Graphics();
    for (let i = trailParticles.length - 1; i >= 0; i--) {
      const tp = trailParticles[i];
      if (!tp) {
        continue;
      }
      tp.life--;
      if (tp.life <= 0) {
        trailParticles.splice(i, 1);
        continue;
      }
      const alpha = (tp.life / 50) * 0.5;
      trailGfx.circle(tp.x, tp.y, tp.size);
      trailGfx.fill({ color: tp.color, alpha });
    }
    // Add trail layer
    trailLayer.removeChildren();
    trailLayer.addChild(trailGfx);
    if (!dragTarget) {
      let needsRedraw = false;
      for (const m of magnets) {
        if (!m.isDragging) {
          const targetX = padding + m.affinity.x * (width - padding * 2);
          const targetY = padding + m.affinity.y * (height - padding * 2);

          const dx = targetX - m.x;
          const dy = targetY - m.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > 1) {
            m.x += dx * 0.015 + Math.sin(Date.now() * 0.001 + m.radius) * 0.15;
            m.y += dy * 0.015 + Math.cos(Date.now() * 0.001 + m.radius) * 0.15;
            needsRedraw = true;
          }
        }
      }

      if (needsRedraw) {
        renderMagnets();
        drawConnections();
      }
    }
  });

  return () => {
    app.ticker.stop();
    app.destroy(true, { children: true });
  };
};

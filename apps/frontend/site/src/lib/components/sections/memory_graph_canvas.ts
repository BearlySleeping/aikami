// apps/frontend/site/src/lib/components/sections/memory_graph_canvas.ts
/**
 * Interactive AI Memory & Agent State Graph visualization.
 * Dual-track: short-term memory buffers (left, fast-pulsing) and
 * long-term world state nodes (right, stable glow).
 * Click nodes to inspect agent state.
 */
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { observeCanvas } from '../../utils/canvas_observer';

/* ── Types ── */

type MemoryNode = {
  id: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  pulseSpeed: number;
  pulsePhase: number;
  isSTM: boolean;
  connections: string[];
};

/* ── Colors ── */

const COLORS = {
  stmActive: 0x818cf8,
  stmFading: 0x6366f1,
  ltmStable: 0x8b5cf6,
  ltmCore: 0xa78bfa,
  edge: 0x4c1d95,
  edgeGlow: 0x7c3aed,
  text: 0xc4b5fd,
  highlight: 0xfbbf24,
  bg: 0x0f0a1a,
};

/* ── Node definitions ── */

const nodes: MemoryNode[] = [
  // Short-term memory (left side — fast pulse)
  {
    id: 'stm-1',
    label: 'Recent Dialog',
    detail: '"The old mine is cursed," the blacksmith muttered.',
    x: 0.18,
    y: 0.2,
    radius: 22,
    color: COLORS.stmActive,
    pulseSpeed: 2.5,
    pulsePhase: 0,
    isSTM: true,
    connections: ['stm-2', 'ltm-1'],
  },
  {
    id: 'stm-2',
    label: 'Active Quest',
    detail: 'Investigate the abandoned dwarven mine.',
    x: 0.22,
    y: 0.45,
    radius: 26,
    color: COLORS.stmActive,
    pulseSpeed: 2.0,
    pulsePhase: 1.2,
    isSTM: true,
    connections: ['stm-1', 'stm-3', 'ltm-2'],
  },
  {
    id: 'stm-3',
    label: 'Combat State',
    detail: '3 goblins spotted. Party HP: 42/56.',
    x: 0.15,
    y: 0.7,
    radius: 20,
    color: COLORS.stmFading,
    pulseSpeed: 3.0,
    pulsePhase: 2.5,
    isSTM: true,
    connections: ['stm-2', 'ltm-3'],
  },
  {
    id: 'stm-4',
    label: 'NPC Mood',
    detail: 'Elara: Anxious. Trust level: 7/10.',
    x: 0.28,
    y: 0.65,
    radius: 18,
    color: COLORS.stmFading,
    pulseSpeed: 2.8,
    pulsePhase: 0.8,
    isSTM: true,
    connections: ['stm-2'],
  },
  // Long-term memory (right side — stable glow)
  {
    id: 'ltm-1',
    label: 'World Lore',
    detail: 'The dwarven kingdom fell 300 years ago. Cause unknown.',
    x: 0.62,
    y: 0.25,
    radius: 28,
    color: COLORS.ltmCore,
    pulseSpeed: 0.8,
    pulsePhase: 0,
    isSTM: false,
    connections: ['ltm-2', 'ltm-4'],
  },
  {
    id: 'ltm-2',
    label: 'Faction Relations',
    detail: 'Guild of Miners: Allied. Dark Circle: Hostile.',
    x: 0.7,
    y: 0.5,
    radius: 30,
    color: COLORS.ltmStable,
    pulseSpeed: 0.6,
    pulsePhase: 1.5,
    isSTM: false,
    connections: ['ltm-1', 'ltm-3', 'ltm-4'],
  },
  {
    id: 'ltm-3',
    label: 'Player Choices',
    detail: "Spared goblin chief. Gained Warden's Mark.",
    x: 0.58,
    y: 0.72,
    radius: 24,
    color: COLORS.ltmStable,
    pulseSpeed: 0.7,
    pulsePhase: 2.0,
    isSTM: false,
    connections: ['ltm-2'],
  },
  {
    id: 'ltm-4',
    label: 'World State',
    detail: 'Region: Frostpeak. Season: Early Winter. Threat: Medium.',
    x: 0.8,
    y: 0.35,
    radius: 26,
    color: COLORS.ltmCore,
    pulseSpeed: 0.5,
    pulsePhase: 3.0,
    isSTM: false,
    connections: ['ltm-1', 'ltm-2'],
  },
];

/* ── Main initialization ── */

export const initMemoryGraph = async (containerId: string): Promise<() => void> => {
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

  const observerCleanup = observeCanvas({ app, container });

  const { width, height } = app.screen;

  // Layers
  const edgeLayer = new Container();
  const nodeLayer = new Container();
  const detailLayer = new Container();
  const labelLayer = new Container();

  app.stage.addChild(edgeLayer);
  app.stage.addChild(nodeLayer);
  app.stage.addChild(detailLayer);
  app.stage.addChild(labelLayer);

  // Resolve positions
  const resolvedNodes = nodes.map((n) => ({
    ...n,
    resolvedX: n.x * width,
    resolvedY: n.y * height,
  }));

  // Edge graphics
  const drawEdges = () => {
    const g = new Graphics();
    for (const node of resolvedNodes) {
      for (const connId of node.connections) {
        const target = resolvedNodes.find((n) => n.id === connId);
        if (!target) {
          continue;
        }

        g.moveTo(node.resolvedX, node.resolvedY);
        g.lineTo(target.resolvedX, target.resolvedY);
        g.stroke({ color: COLORS.edge, alpha: 0.3, width: 1.2 });
      }
    }
    edgeLayer.removeChildren();
    edgeLayer.addChild(g);
  };

  drawEdges();

  // Node graphics
  const nodeGfx = new Graphics();
  nodeLayer.addChild(nodeGfx);

  // Detail text
  const detailText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'Inter, sans-serif',
      fontSize: 12,
      fill: '#c4b5fd',
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 200,
    }),
  });
  detailText.anchor.set(0.5);
  detailText.alpha = 0;
  detailLayer.addChild(detailText);

  const detailLabel = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      fill: '#a78bfa',
      align: 'center',
      letterSpacing: 2,
    }),
  });
  detailLabel.anchor.set(0.5);
  detailLabel.alpha = 0;
  detailLayer.addChild(detailLabel);

  // Interactive state
  let hoveredNode: MemoryNode | null = null;

  app.canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const node of resolvedNodes) {
      const dx = mx - node.resolvedX;
      const dy = my - node.resolvedY;
      if (Math.sqrt(dx * dx + dy * dy) < node.radius + 4) {
        hoveredNode = hoveredNode?.id === node.id ? null : node;
        if (hoveredNode) {
          detailLabel.text = hoveredNode.label.toUpperCase();
          detailText.text = hoveredNode.detail;
          detailLabel.x = Math.min(Math.max(node.resolvedX, 120), width - 120);
          detailText.x = detailLabel.x;
          detailLabel.y = Math.min(node.resolvedY - node.radius - 12, height - 70);
          detailText.y = detailLabel.y + 20;
          detailLabel.alpha = 1;
          detailText.alpha = 1;
        } else {
          detailLabel.alpha = 0;
          detailText.alpha = 0;
        }
        break;
      }
    }
  });

  app.canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found = false;
    for (const node of resolvedNodes) {
      const dx = mx - node.resolvedX;
      const dy = my - node.resolvedY;
      if (Math.sqrt(dx * dx + dy * dy) < node.radius + 4) {
        app.canvas.style.cursor = 'pointer';
        found = true;
        break;
      }
    }
    if (!found) {
      app.canvas.style.cursor = 'default';
    }
  });

  // Labels
  for (const node of resolvedNodes) {
    const label = new Text({
      text: node.label,
      style: new TextStyle({
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 9,
        fill: '#a78bfa',
        align: 'center',
        letterSpacing: 1,
      }),
    });
    label.anchor.set(0.5);
    label.x = node.resolvedX;
    label.y = node.resolvedY + node.radius + 12;
    labelLayer.addChild(label);
  }

  // Section labels
  const stmLabel = new Text({
    text: 'SHORT-TERM MEMORY',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9,
      fill: '#6366f1',
      letterSpacing: 3,
    }),
  });
  stmLabel.anchor.set(0.5);
  stmLabel.x = width * 0.22;
  stmLabel.y = height * 0.05;
  labelLayer.addChild(stmLabel);

  const ltmLabel = new Text({
    text: 'LONG-TERM WORLD STATE',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9,
      fill: '#8b5cf6',
      letterSpacing: 3,
    }),
  });
  ltmLabel.anchor.set(0.5);
  ltmLabel.x = width * 0.68;
  ltmLabel.y = height * 0.05;
  labelLayer.addChild(ltmLabel);

  // Divider line
  const dividerGfx = new Graphics();
  dividerGfx.moveTo(width * 0.45, height * 0.02);
  dividerGfx.lineTo(width * 0.45, height * 0.98);
  dividerGfx.stroke({ color: 0x4c1d95, alpha: 0.25, width: 1 });
  labelLayer.addChild(dividerGfx);

  // Ticker
  app.ticker.add(() => {
    const g = new Graphics();

    for (const node of resolvedNodes) {
      const phase = Date.now() * 0.001 * node.pulseSpeed + node.pulsePhase;
      const pulse = 0.7 + 0.3 * Math.sin(phase);
      const isHighlighted = hoveredNode?.id === node.id;

      // Glow ring
      if (isHighlighted) {
        g.circle(node.resolvedX, node.resolvedY, node.radius + 8);
        g.fill({ color: COLORS.highlight, alpha: 0.3 });
      }

      // Outer ring (STM = dashed feel, LTM = solid)
      if (node.isSTM) {
        g.circle(node.resolvedX, node.resolvedY, node.radius + 3);
        g.stroke({ color: node.color, alpha: 0.5 * pulse, width: 1.5 });
      } else {
        g.circle(node.resolvedX, node.resolvedY, node.radius + 4);
        g.fill({ color: node.color, alpha: 0.15 });
        g.stroke({ color: node.color, alpha: 0.6, width: 1.5 });
      }

      // Core circle
      g.circle(node.resolvedX, node.resolvedY, node.radius);
      g.fill({ color: node.color, alpha: isHighlighted ? 0.85 : 0.55 * pulse });

      // Center highlight
      g.circle(node.resolvedX, node.resolvedY, node.radius * 0.4);
      g.fill({ color: 0xffffff, alpha: 0.15 * pulse });

      if (isHighlighted) {
        g.circle(node.resolvedX, node.resolvedY, node.radius + 6);
        g.stroke({ color: COLORS.highlight, alpha: 0.6, width: 2 });
      }
    }

    nodeLayer.removeChild(nodeGfx);
    nodeLayer.addChildAt(g, 0);
  });

  return () => {
    observerCleanup();
    app.ticker.stop();
    app.destroy(true, { children: true });
  };
};

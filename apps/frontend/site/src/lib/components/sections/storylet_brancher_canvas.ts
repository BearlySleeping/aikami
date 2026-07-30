// apps/frontend/site/src/lib/components/sections/storylet_brancher_canvas.ts
/**
 * Interactive Storylet Branching Inspector.
 * Visualizes narrative branching with colored bundles (Courage vs Corruption).
 * Click nodes to preview alternate storyline outcomes.
 */
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { observeCanvas } from '../../utils/canvas_observer';

/* ── Types ── */

type BranchNode = {
  id: string;
  label: string;
  preview: string;
  x: number;
  y: number;
  courageScore: number; // 0-1, 1 = pure courage
  corruptionScore: number; // 0-1, 1 = pure corruption
  isChoice: boolean;
  children: string[];
};

const COLORS = {
  courage: 0xfbbf24,
  courageGlow: 0xfcd34d,
  corruption: 0x9f1239,
  corruptionGlow: 0xe11d48,
  neutral: 0x8b5cf6,
  text: 0xc4b5fd,
  edge: 0x4c1d95,
};

/* ── Tree data ── */

const tree: BranchNode[] = [
  // Root
  {
    id: 'root',
    label: 'The Ancient Tomb',
    preview: 'A dark entrance beckons. Torchlight flickers on rune-carved walls.',
    x: 0.5,
    y: 0.08,
    courageScore: 0.5,
    corruptionScore: 0.5,
    isChoice: false,
    children: ['a1', 'b1'],
  },
  // Branch A — Courage path
  {
    id: 'a1',
    label: 'Light the Braziers',
    preview:
      'You restore the sacred flames. The spirits of the tomb awaken peacefully, offering guidance.',
    x: 0.28,
    y: 0.32,
    courageScore: 0.8,
    corruptionScore: 0.2,
    isChoice: true,
    children: ['a2', 'a3'],
  },
  {
    id: 'a2',
    label: 'Speak to the Guardian',
    preview:
      'The stone guardian bows. "Long have I awaited one pure of heart." It grants you the Sunblade.',
    x: 0.18,
    y: 0.58,
    courageScore: 0.95,
    corruptionScore: 0.05,
    isChoice: true,
    children: ['a4'],
  },
  {
    id: 'a4',
    label: "The Hero's Path",
    preview:
      "Armed with the Sunblade, you become the realm's champion. Kingdoms unite under your banner.",
    x: 0.12,
    y: 0.84,
    courageScore: 1.0,
    corruptionScore: 0.0,
    isChoice: false,
    children: [],
  },
  {
    id: 'a3',
    label: 'Examine the Relics',
    preview: "Ancient texts reveal the tomb's true purpose — a seal holding back a great darkness.",
    x: 0.35,
    y: 0.58,
    courageScore: 0.7,
    corruptionScore: 0.4,
    isChoice: true,
    children: [],
  },
  // Branch B — Corruption path
  {
    id: 'b1',
    label: 'Loot the Sarcophagi',
    preview:
      'Greed overtakes you. As you pry open the golden coffin, a dark curse marks your soul.',
    x: 0.72,
    y: 0.32,
    courageScore: 0.2,
    corruptionScore: 0.85,
    isChoice: true,
    children: ['b2', 'b3'],
  },
  {
    id: 'b2',
    label: 'Embrace the Curse',
    preview: 'Power surges through you. The dead rise at your command. The living realms tremble.',
    x: 0.65,
    y: 0.58,
    courageScore: 0.05,
    corruptionScore: 0.95,
    isChoice: true,
    children: ['b4'],
  },
  {
    id: 'b4',
    label: 'The Dark Lord',
    preview: 'You become the very darkness the ancients feared. An age of shadow begins.',
    x: 0.6,
    y: 0.84,
    courageScore: 0.0,
    corruptionScore: 1.0,
    isChoice: false,
    children: [],
  },
  {
    id: 'b3',
    label: 'Resist the Curse',
    preview:
      'You fight the corruption with sheer will. Scarred but unbroken, you gain forbidden knowledge.',
    x: 0.82,
    y: 0.58,
    courageScore: 0.45,
    corruptionScore: 0.55,
    isChoice: true,
    children: [],
  },
];

/* ── Helpers ── */

const nodeColor = (node: BranchNode): number => {
  if (node.courageScore > node.corruptionScore + 0.3) {
    return COLORS.courage;
  }
  if (node.corruptionScore > node.courageScore + 0.3) {
    return COLORS.corruption;
  }
  return COLORS.neutral;
};

/* ── Init ── */

export const initStoryletBrancher = async (containerId: string): Promise<() => void> => {
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

  const edgeLayer = new Container();
  const nodeLayer = new Container();
  const previewLayer = new Container();

  app.stage.addChild(edgeLayer);
  app.stage.addChild(nodeLayer);
  app.stage.addChild(previewLayer);

  const resolved = tree.map((n) => ({
    ...n,
    rx: n.x * width,
    ry: n.y * height,
  }));

  // Draw edges
  const drawEdges = () => {
    const g = new Graphics();
    for (const node of resolved) {
      for (const childId of node.children) {
        const child = resolved.find((n) => n.id === childId);
        if (!child) {
          continue;
        }

        // Quadratic bezier edge
        const midX = (node.rx + child.rx) / 2;
        const midY = (node.ry + child.ry) / 2 - 15;

        g.moveTo(node.rx, node.ry);
        g.quadraticCurveTo(midX, midY, child.rx, child.ry);
        g.stroke({
          color: nodeColor(node),
          alpha: 0.4,
          width: 1.5,
        });
      }
    }
    edgeLayer.removeChildren();
    edgeLayer.addChild(g);
  };

  drawEdges();

  // Preview panel
  const previewBg = new Graphics();
  previewBg.roundRect(0, 0, 220, 80, 8);
  previewBg.fill({ color: 0x1a102a, alpha: 0.95 });
  previewBg.stroke({ color: COLORS.neutral, alpha: 0.5, width: 1 });
  previewLayer.addChild(previewBg);

  const previewText = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'Inter, sans-serif',
      fontSize: 11,
      fill: '#c4b5fd',
      align: 'left',
      wordWrap: true,
      wordWrapWidth: 200,
    }),
  });
  previewText.x = 12;
  previewText.y = 10;
  previewLayer.addChild(previewText);

  const previewLabel = new Text({
    text: '',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9,
      fill: '#a78bfa',
      letterSpacing: 2,
      fontWeight: 'bold',
    }),
  });
  previewLabel.x = 12;
  previewLabel.y = 55;
  previewLayer.addChild(previewLabel);

  previewLayer.alpha = 0;

  let activeNode: (typeof resolved)[number] | null = null;

  // Draw nodes
  const drawNodes = () => {
    const g = new Graphics();
    const labels: Text[] = [];

    for (const node of resolved) {
      const color = nodeColor(node);
      const radius = node.isChoice ? 10 : 14;
      const isActive = activeNode?.id === node.id;

      // Glow
      g.circle(node.rx, node.ry, radius + (isActive ? 8 : 4));
      g.fill({ color, alpha: isActive ? 0.3 : 0.12 });

      // Core
      g.circle(node.rx, node.ry, radius);
      g.fill({ color, alpha: isActive ? 0.9 : 0.7 });

      // Choice indicator
      if (node.isChoice) {
        g.circle(node.rx, node.ry, radius + 2);
        g.stroke({ color: 0xffffff, alpha: 0.4, width: 1 });
      }

      // Label
      const lbl = new Text({
        text: node.label,
        style: new TextStyle({
          fontFamily: 'Inter, sans-serif',
          fontSize: isActive ? 11 : 9,
          fill: isActive ? '#ffffff' : '#a78bfa',
          align: 'center',
          fontWeight: isActive ? 'bold' : 'normal',
        }),
      });
      lbl.anchor.set(0.5);
      lbl.x = node.rx;
      lbl.y = node.ry + radius + 12;
      labels.push(lbl);
    }

    nodeLayer.removeChildren();
    nodeLayer.addChild(g);
    for (const lbl of labels) {
      nodeLayer.addChild(lbl);
    }
  };

  drawNodes();

  // Legend
  const courageLabel = new Text({
    text: 'COURAGE',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9,
      fill: '#fbbf24',
      letterSpacing: 3,
    }),
  });
  courageLabel.anchor.set(0.5);
  courageLabel.x = 55;
  courageLabel.y = height - 20;
  nodeLayer.addChild(courageLabel);

  const corruptionLabel = new Text({
    text: 'CORRUPTION',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9,
      fill: '#e11d48',
      letterSpacing: 3,
    }),
  });
  corruptionLabel.anchor.set(0.5);
  corruptionLabel.x = width - 70;
  corruptionLabel.y = height - 20;
  nodeLayer.addChild(corruptionLabel);

  const titleLabel = new Text({
    text: 'NARRATIVE BRANCHING SPACE',
    style: new TextStyle({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9,
      fill: '#8b5cf6',
      letterSpacing: 3,
    }),
  });
  titleLabel.anchor.set(0.5);
  titleLabel.x = width / 2;
  titleLabel.y = height - 26;
  nodeLayer.addChild(titleLabel);

  // Interaction
  app.canvas.addEventListener('click', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const node of resolved) {
      const dx = mx - node.rx;
      const dy = my - node.ry;
      if (Math.sqrt(dx * dx + dy * dy) < 18) {
        activeNode = activeNode?.id === node.id ? null : node;
        if (activeNode) {
          previewLabel.text = activeNode.label.toUpperCase();
          previewText.text = activeNode.preview;
          previewBg.x = Math.min(Math.max(activeNode.rx + 24, 10), width - 230);
          previewBg.y = Math.min(Math.max(activeNode.ry - 40, 10), height - 90);
          previewLabel.x = previewBg.x + 12;
          previewLabel.y = previewBg.y + 55;
          previewText.x = previewBg.x + 12;
          previewText.y = previewBg.y + 10;
          previewLayer.alpha = 1;
        } else {
          previewLayer.alpha = 0;
        }
        drawNodes();
        drawEdges();
        break;
      }
    }
  });

  app.canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found = false;
    for (const node of resolved) {
      const dx = mx - node.rx;
      const dy = my - node.ry;
      if (Math.sqrt(dx * dx + dy * dy) < 18) {
        app.canvas.style.cursor = 'pointer';
        found = true;
        break;
      }
    }
    if (!found) {
      app.canvas.style.cursor = 'default';
    }
  });

  return () => {
    observerCleanup();
    app.ticker.stop();
    app.destroy(true, { children: true });
  };
};

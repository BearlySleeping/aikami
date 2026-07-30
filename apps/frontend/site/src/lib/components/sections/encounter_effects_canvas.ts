// apps/frontend/site/src/lib/components/sections/encounter_effects_canvas.ts
/**
 * Encounter Card combination effect preview canvas.
 * Renders spell combination visual effects when two cards are slotted together.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { observeCanvas } from '../../utils/canvas_observer';

/* ── Effect types ── */

type EffectParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
};

const combos: Record<string, { primaryColor: number; secondaryColor: number; intensity: number }> =
  {
    'flame-arc+shadow-step': { primaryColor: 0xf59e0b, secondaryColor: 0x7c3aed, intensity: 1.2 },
    'flame-arc+frost-barrier': { primaryColor: 0xf59e0b, secondaryColor: 0x22d3ee, intensity: 1.0 },
    'shadow-step+frost-barrier': {
      primaryColor: 0x7c3aed,
      secondaryColor: 0x22d3ee,
      intensity: 1.0,
    },
    'divine-smite+shadow-step': {
      primaryColor: 0xfbbf24,
      secondaryColor: 0x7c3aed,
      intensity: 1.3,
    },
    'divine-smite+flame-arc': { primaryColor: 0xfbbf24, secondaryColor: 0xf59e0b, intensity: 1.1 },
    'divine-smite+frost-barrier': {
      primaryColor: 0xfbbf24,
      secondaryColor: 0x22d3ee,
      intensity: 0.9,
    },
    'flame-arc+flame-arc': { primaryColor: 0xf59e0b, secondaryColor: 0xef4444, intensity: 1.5 },
    'shadow-step+shadow-step': { primaryColor: 0x7c3aed, secondaryColor: 0x4c1d95, intensity: 1.5 },
  };

export const triggerComboEffect = async (
  containerId: string,
  cardA: string,
  cardB: string,
): Promise<void> => {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const app = new Application();

  await app.init({
    resizeTo: container,
    backgroundAlpha: 0,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  container.innerHTML = '';
  container.appendChild(app.canvas);

  const observerCleanup = observeCanvas({ app, container });

  const { width, height } = app.screen;
  const effectLayer = new Container();
  app.stage.addChild(effectLayer);

  const comboKey = `${cardA}+${cardB}`;
  const combo = combos[comboKey] ?? {
    primaryColor: 0x8b5cf6,
    secondaryColor: 0x6366f1,
    intensity: 0.8,
  };

  // Generate effect particles
  const particles: EffectParticle[] = [];
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < 200 * combo.intensity; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (1 + Math.random() * 6) * combo.intensity;
    const color = Math.random() > 0.4 ? combo.primaryColor : combo.secondaryColor;

    particles.push({
      x: cx + (Math.random() - 0.5) * 30,
      y: cy + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 60 + Math.random() * 60,
      maxLife: 120,
      size: 1.5 + Math.random() * 4,
      color,
    });
  }

  // Center flash
  let flashAlpha = 0.6;

  let running = true;

  app.ticker.add(() => {
    if (!running) {
      return;
    }
    const g = new Graphics();

    // Flash
    if (flashAlpha > 0) {
      g.circle(cx, cy, 80);
      g.fill({ color: combo.primaryColor, alpha: flashAlpha });
      flashAlpha -= 0.015;
    }

    // Particles
    for (const p of particles) {
      if (p.life <= 0) {
        continue;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.vy += 0.02;
      p.life--;

      const alpha = Math.min(1, p.life / (p.maxLife * 0.3)) * 0.8;
      g.circle(p.x, p.y, p.size * (p.life / p.maxLife));
      g.fill({ color: p.color, alpha });
    }

    // Ripple rings
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const progress = ((flashAlpha * 60 + i * 20) % 60) / 60;
      const ringRadius = 30 + progress * 120;
      const alpha = (1 - progress) * 0.3;

      g.circle(cx, cy, ringRadius);
      g.stroke({ color: combo.primaryColor, alpha, width: 1.5 });
    }

    effectLayer.removeChildren();
    effectLayer.addChild(g);

    // Cleanup after animation
    if (flashAlpha <= 0 && particles.every((p) => p.life <= 0)) {
      running = false;

      // Fade out and destroy
      setTimeout(() => {
        observerCleanup();
        app.destroy(true, { children: true });
      }, 500);
    }
  });
};

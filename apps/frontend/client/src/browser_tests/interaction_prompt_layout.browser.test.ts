// apps/frontend/client/src/browser_tests/interaction_prompt_layout.browser.test.ts
//
// Evidenced layout acceptance for the contextual interaction prompt
// (`interaction_prompt.svelte` + `.hud-prompt--target` in aikami_game_ui.css).
//
// The prompt is anchored to a world-space target, so a long interaction label
// ("E — Speak with Archmagus … of the Eastern Reaches") at 200% text can grow
// taller than the gap its anchor leaves. These assertions are measured in a
// real 800×600 viewport with the shipped theme stylesheet, not asserted by
// reading the CSS.

import '../../../../../packages/frontend/theme/src/lib/aikami_game_ui.css';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import InteractionPrompt from '../lib/views/game/ui/hud/interaction_prompt.svelte';

const mounted: Array<ReturnType<typeof mount>> = [];

/** A label shaped exactly like the production one: `${keyLabel} — ${verb} ${name}`. */
const LONG_LABEL = 'E — Speak with Archmagus Lysanthius Moonveil, Warden of the Eastern Reaches';

const EDGE_MARGIN_PX = 8;

const mountPrompt = (label: string, screenX: number, screenY: number) => {
  const scope = document.createElement('div');
  scope.setAttribute('data-aikami-theme-scope', '');
  scope.style.position = 'fixed';
  scope.style.inset = '0';
  const widget = document.createElement('div');
  widget.className = 'hud-widget';
  widget.setAttribute('data-hud-widget', 'interaction');
  scope.append(widget);
  document.body.append(scope);

  const component = mount(InteractionPrompt, {
    target: widget,
    props: { label, visible: true, screenX, screenY },
  });
  mounted.push(component);

  const prompt = scope.querySelector<HTMLElement>('[data-testid="interaction-prompt"]');
  if (!prompt) {
    throw new Error('interaction prompt did not render');
  }
  return { prompt, scope };
};

afterEach(async () => {
  while (mounted.length > 0) {
    const component = mounted.pop();
    if (component) {
      await unmount(component);
    }
  }
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty('font-size');
});

const expectInsideViewport = (prompt: HTMLElement, label: string): void => {
  const rect = prompt.getBoundingClientRect();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  expect({
    label,
    viewport,
    rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    fitsVertically: rect.top >= EDGE_MARGIN_PX && rect.bottom <= viewport.height - EDGE_MARGIN_PX,
    fitsHorizontally: rect.left >= EDGE_MARGIN_PX && rect.right <= viewport.width - EDGE_MARGIN_PX,
  }).toMatchObject({ fitsVertically: true, fitsHorizontally: true });
};

describe('interaction prompt — target anchoring under long labels and 200% text', () => {
  test('an 800×600 viewport at 200% text keeps a long prompt fully on screen', () => {
    document.documentElement.style.fontSize = '32px';

    // The target stands near the bottom of the screen, the worst case for the
    // prompt's upward offset.
    const { prompt } = mountPrompt(LONG_LABEL, window.innerWidth / 2, window.innerHeight - 20);

    expectInsideViewport(prompt, LONG_LABEL);
  });

  test('a target at the left edge keeps the prompt fully on screen', () => {
    document.documentElement.style.fontSize = '32px';

    const { prompt } = mountPrompt(LONG_LABEL, 4, window.innerHeight / 2);

    expectInsideViewport(prompt, LONG_LABEL);
  });

  test('the label wraps instead of overflowing its own surface', () => {
    document.documentElement.style.fontSize = '32px';

    const { prompt } = mountPrompt(LONG_LABEL, window.innerWidth / 2, window.innerHeight - 20);
    const text = prompt.querySelector('span');

    expect(text).not.toBeNull();
    // No horizontal overflow inside the prompt: the text reflows.
    expect(prompt.scrollWidth).toBeLessThanOrEqual(Math.ceil(prompt.clientWidth) + 1);
    // …and it is genuinely multi-line rather than truncated or clipped.
    const range = document.createRange();
    range.selectNodeContents(text as HTMLElement);
    expect(range.getClientRects().length).toBeGreaterThan(1);
    range.detach();
  });

  test('a short label at 100% text keeps the default placement', () => {
    const { prompt } = mountPrompt('E — Talk to Elder Thalia', window.innerWidth / 2, 400);

    expectInsideViewport(prompt, 'E — Talk to Elder Thalia');
  });
});

// apps/frontend/pwa/src/lib/client/game/ui/dialogue_controller_streaming.test.ts

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type {
  DialogueGeneratorInterface,
  DialogueGeneratorOptions,
} from '$lib/client/game/systems/interaction_bridge.ts';
import type { InteractableNpcEntry } from '$lib/client/game/systems/interaction_system.ts';
import { type DialogueControllerInterface, getDialogueController } from './dialogue_controller.ts';

// ---------------------------------------------------------------------------
// DOM polyfill — Bun test doesn't provide full DOM, so we set up a minimal
// document environment for the DialogueController's vanilla DOM manipulation.
// ---------------------------------------------------------------------------

/** HTML element representation for our test polyfill. */
type TestElement = {
  id: string;
  tagName: string;
  textContent: string;
  style: Record<string, string>;
  className: string;
  disabled: boolean;
  scrollTop: number;
  children: TestElement[];
  parentNode: TestElement | null;
  focus: () => void;
  addEventListener: (event: string, handler: (e: unknown) => void) => void;
  removeEventListener: (event: string, handler: (e: unknown) => void) => void;
  appendChild: (child: TestElement) => void;
  remove: () => void;
  insertBefore: (node: TestElement, ref: TestElement | null) => void;
  removeChild: (child: TestElement) => void;
  querySelector: (selector: string) => TestElement | null;
  clickHandlers: Array<(e: unknown) => void>;
  firstChild: TestElement | null;
};

const createTestElement = (id: string, tagName = 'div'): TestElement => ({
  id,
  tagName,
  textContent: '',
  style: {},
  className: '',
  disabled: false,
  scrollTop: 0,
  children: [],
  parentNode: null,
  focus() {},
  addEventListener(_event: string, handler: (e: unknown) => void) {
    this.clickHandlers.push(handler);
  },
  removeEventListener() {},
  appendChild(child: TestElement) {
    child.parentNode = this;
    this.children.push(child);
  },
  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  },
  insertBefore(node: TestElement, ref: TestElement | null) {
    node.parentNode = this;
    if (ref) {
      const idx = this.children.indexOf(ref);
      if (idx >= 0) {
        this.children.splice(idx, 0, node);
        return;
      }
    }
    this.children.push(node);
  },
  removeChild(child: TestElement) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
    }
    child.parentNode = null;
  },
  querySelector(selector: string): TestElement | null {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return (
        this.children.find(
          (c) => typeof c.className === 'string' && c.className.includes(className),
        ) ?? null
      );
    }
    if (selector.startsWith('#')) {
      return (
        this.children.find((c) => typeof c.id === 'string' && c.id === selector.slice(1)) ?? null
      );
    }
    return null;
  },
  clickHandlers: [],
  firstChild: null,
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const createMockNpc = (overrides?: Partial<InteractableNpcEntry>): InteractableNpcEntry => ({
  eid: 1,
  position: { x: 100, y: 200 },
  radius: 64,
  inRange: true,
  npcName: 'Elder Thrain',
  personaId: 'persona-elder-001',
  npcId: 'npc-elder-001',
  relationshipValue: 50,
  ...overrides,
});

const createMockGenerator = (): DialogueGeneratorInterface & {
  generateDialogueSpy: ReturnType<typeof mock>;
  cancelGenerationSpy: ReturnType<typeof mock>;
  _isGenerating: boolean;
  _currentText: string;
} => {
  const state = { isGenerating: false, currentText: '' };

  const generateDialogueSpy = mock((_options: DialogueGeneratorOptions) => {
    state.isGenerating = true;
    state.currentText = '';
    return Promise.resolve();
  });

  const cancelGenerationSpy = mock(() => {
    state.isGenerating = false;
    state.currentText = '';
  });

  const generator = {
    get isGenerating() {
      return state.isGenerating;
    },
    get currentText() {
      return state.currentText;
    },
    generateDialogue: generateDialogueSpy,
    cancelGeneration: cancelGenerationSpy,
    generateDialogueSpy,
    cancelGenerationSpy,
    get _isGenerating() {
      return state.isGenerating;
    },
    set _isGenerating(v: boolean) {
      state.isGenerating = v;
    },
    get _currentText() {
      return state.currentText;
    },
    set _currentText(v: string) {
      state.currentText = v;
    },
  };

  return generator;
};

const createMockFunctions = () =>
  ({
    callFunction: mock(() =>
      Promise.resolve({ result: { reply: 'Hello!', relationshipDelta: 0 } }),
    ),
  }) as unknown as import('$lib/client/game/services/firebase/functions.ts').FirebaseFunctionsInterface;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DialogueController — AC3: Streaming Mode & Abort', () => {
  let controller: DialogueControllerInterface;
  let generator: ReturnType<typeof createMockGenerator>;
  let bodyChildren: TestElement[];

  beforeAll(() => {
    bodyChildren = [];
    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => {
        return createTestElement(
          tag === 'input' ? 'input' : tag === 'button' ? 'button' : tag === 'h2' ? 'h2' : tag,
          tag,
        ) as TestElement;
      },
      createTextNode: (text: string) => ({
        textContent: text,
        nodeType: 3,
        children: [] as TestElement[],
        id: '',
      }),
      getElementById: (id: string) => {
        const findRecursive = (els: TestElement[]): TestElement | null => {
          for (const el of els) {
            if (el.id === id) {
              return el;
            }
            const found = findRecursive(el.children);
            if (found) {
              return found;
            }
          }
          return null;
        };
        return findRecursive(bodyChildren);
      },
      body: {
        appendChild: (el: TestElement) => {
          bodyChildren.push(el);
        },
        children: bodyChildren,
        removeChild: (el: TestElement) => {
          const idx = bodyChildren.indexOf(el);
          if (idx >= 0) {
            bodyChildren.splice(idx, 1);
          }
        },
      },
    };
    (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: () => void) => {
      setTimeout(cb, 16);
    };
    (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
    (globalThis as Record<string, unknown>).setTimeout = globalThis.setTimeout;
    (globalThis as Record<string, unknown>).clearTimeout = globalThis.clearTimeout;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  });

  beforeEach(() => {
    bodyChildren = [];
    generator = createMockGenerator();
    controller = getDialogueController({
      className: 'TestDialogueController',
      functions: createMockFunctions(),
      generator,
    });
  });

  test('should call generateDialogue on the generator when start is called', () => {
    const npc = createMockNpc();

    controller.start(npc);

    expect(generator.generateDialogueSpy).toHaveBeenCalledTimes(1);
    const callArg = generator.generateDialogueSpy.mock.calls[0][0] as DialogueGeneratorOptions;
    expect(callArg.npcId).toBe('npc-elder-001');
    expect(callArg.personaId).toBe('persona-elder-001');
  });

  test('should enter streaming mode when start is called with generator', () => {
    const npc = createMockNpc();
    expect(controller.isStreaming).toBe(false);

    controller.start(npc);

    expect(controller.isStreaming).toBe(true);
    expect(controller.isActive).toBe(true);
  });

  test('should call cancelGeneration when end is called during streaming', () => {
    const npc = createMockNpc();
    controller.start(npc);

    controller.end();

    expect(generator.cancelGenerationSpy).toHaveBeenCalledTimes(1);
    expect(controller.isActive).toBe(false);
    expect(controller.isStreaming).toBe(false);
  });

  test('should update streaming message as generator.currentText changes', async () => {
    const npc = createMockNpc();

    // Set up the generator to simulate streaming
    generator._isGenerating = true;
    generator._currentText = '';

    controller.start(npc);

    // Simulate progressive text arriving
    generator._currentText = 'Hello';
    // Trigger the poll interval manually
    await new Promise((resolve) => setTimeout(resolve, 60));

    generator._currentText = 'Hello, traveler';
    await new Promise((resolve) => setTimeout(resolve, 60));

    generator._currentText = 'Hello, traveler! Welcome to our village.';
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Finalize: set isGenerating to false
    generator._isGenerating = false;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(controller.isStreaming).toBe(false);

    // Clean up
    controller.end();
  });

  test('should tear down controller on end', () => {
    const npc = createMockNpc();
    controller.start(npc);

    expect(controller.isActive).toBe(true);

    controller.end();

    expect(controller.isActive).toBe(false);
    expect(controller.isStreaming).toBe(false);
  });
});

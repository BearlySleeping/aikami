// apps/frontend/client/src/lib/views/lorebook/lorebook_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the Lorebook / World Info system (C-238 AC-5).
// Provides mock lorebooks + entries, keyword scanner simulator with
// live scan results, Active Context panel simulation, and AI generator
// mock (returns hardcoded entries, no LLM call).

import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services';
import { scanKeywords } from '$lib/services/lorebook/keyword_scanner';
import type { KeywordMatch, LorebookEntry, LorebookEntryInput } from '$types/lorebook';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LorebookSandboxViewModelInterface = BaseDevViewModelInterface & {
  /** Sample message to scan against lorebook entries. */
  readonly scannerInput: string;
  /** Live scan results from the keyword scanner. */
  readonly scanResults: KeywordMatch[];
  /** Whether the Active Context panel drawer is open. */
  readonly activeContextOpen: boolean;
  /** Total byte size of matched entry content. */
  readonly tokenBudget: number;

  /** Generated entries from the mock AI generator. */
  readonly generatedEntries: LorebookEntryInput[];
  /** Whether the generator is currently loading. */
  readonly isGenerating: boolean;

  /** Sets the scanner input text. */
  setScannerInput: (value: string) => void;
  /** Opens the Active Context panel. */
  openActiveContext: () => void;
  /** Closes the Active Context panel. */
  closeActiveContext: () => void;

  /** Triggers mock entry generation from world notes. */
  generateEntries: (notes: string) => void;
  /** Saves generated entries. */
  saveGeneratedEntries: () => void;
  /** Clears generated entries. */
  clearGeneratedEntries: () => void;

  /** Resets all state to defaults. */
  resetAll: () => void;
};

export type LorebookSandboxViewModelOptions = BaseDevViewModelOptions & {};

// ---------------------------------------------------------------------------
// Mock entries
// ---------------------------------------------------------------------------

const MOCK_ENTRIES: LorebookEntry[] = [
  {
    id: 'mock-1',
    keywords: ['goblin', 'goblins'],
    content:
      'Goblins are small, green-skinned creatures that inhabit the eastern forests of Eldoria. They travel in packs of 3-6 and are known for their crude weapons and traps.',
    priority: 10,
    constant: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'mock-2',
    keywords: ['dragon', 'dragons'],
    content:
      'Dragons are ancient beings that guard the northern mountains. The most famous is Varthrax, a red dragon who has slept for 300 years atop the Golden Peak.',
    priority: 8,
    constant: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'mock-3',
    keywords: ['eldoria', 'kingdom'],
    content:
      'The Kingdom of Eldoria is a medieval fantasy realm ruled by King Aldric IV from the capital city of Thornwall. It spans from the Azure Sea to the Ironcrest Mountains.',
    priority: 0,
    constant: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'mock-4',
    keywords: ['elf', 'elves'],
    content:
      'Elves are tall, graceful beings who live in the Silverwood Forest. They are skilled archers and practitioners of nature magic. Their queen, Elara, has ruled for 500 years.',
    priority: 5,
    constant: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

const MOCK_GENERATED: LorebookEntryInput[] = [
  {
    keywords: ['thornwall'],
    content:
      'Thornwall is the capital city of Eldoria, known for its towering stone walls covered in rose vines.',
  },
  {
    keywords: ['ironcrest'],
    content:
      'The Ironcrest Mountains are rich in ore and home to the dwarf clans of the Deepforge.',
  },
  {
    keywords: ['azure sea'],
    content:
      'The Azure Sea borders Eldoria to the south. Its waters are said to hide the ruins of an ancient civilization.',
    priority: 3,
  },
];

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class LorebookSandboxViewModel
  extends BaseDevViewModel<LorebookSandboxViewModelOptions>
  implements LorebookSandboxViewModelInterface
{
  scannerInput = $state('I see a goblin in the forest near Eldoria.');
  activeContextOpen = $state(false);
  generatedEntries = $state<LorebookEntryInput[]>([]);
  isGenerating = $state(false);

  // ── Derived ─────────────────────────────────────────────────────────────

  get scanResults(): KeywordMatch[] {
    if (!this.scannerInput.trim()) {
      return [];
    }
    return scanKeywords({ entries: MOCK_ENTRIES, message: this.scannerInput });
  }

  get tokenBudget(): number {
    const encoder = new TextEncoder();
    let total = 0;
    for (const match of this.scanResults) {
      total += encoder.encode(match.entry.content).length;
    }
    return total;
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  setScannerInput(value: string): void {
    this.scannerInput = value;
  }

  openActiveContext(): void {
    this.activeContextOpen = true;
  }

  closeActiveContext(): void {
    this.activeContextOpen = false;
  }

  generateEntries(_notes: string): void {
    this.isGenerating = true;
    // Simulate LLM delay with mock entries
    setTimeout(() => {
      this.generatedEntries = MOCK_GENERATED;
      this.isGenerating = false;
    }, 500);
  }

  saveGeneratedEntries(): void {
    // In sandbox, just clear the preview — no real persistence
    this.generatedEntries = [];
  }

  clearGeneratedEntries(): void {
    this.generatedEntries = [];
  }

  resetAll(): void {
    this.scannerInput = 'I see a goblin in the forest near Eldoria.';
    this.activeContextOpen = false;
    this.generatedEntries = [];
    this.isGenerating = false;
  }
}

export const getLorebookSandboxViewModel = (
  options: LorebookSandboxViewModelOptions,
): LorebookSandboxViewModelInterface => LorebookSandboxViewModel.create(options);

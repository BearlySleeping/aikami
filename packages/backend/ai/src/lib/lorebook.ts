export interface LorebookEntry {
  id: string;
  keywords: string[];
  content: string;
  priority: number;
}

export interface LorebookScanOptions {
  maxCharacters?: number;
}

export class LorebookService {
  private entries: LorebookEntry[] = [];

  constructor(initialEntries: LorebookEntry[] = []) {
    this.entries = initialEntries;
  }

  public addEntry(entry: LorebookEntry): void {
    this.entries.push(entry);
  }

  public getEntries(): LorebookEntry[] {
    return [...this.entries];
  }

  public static getMockEntries(): LorebookEntry[] {
    return [
      {
        id: 'king-auric',
        keywords: ['king', 'Auric', 'ruler'],
        content: 'King Auric is the wise but aging ruler of the Silver Kingdom. He is known for his signature golden crown and his legendary sword, Sun-Bringer.',
        priority: 10,
      },
      {
        id: 'silver-kingdom',
        keywords: ['kingdom', 'Silver Kingdom', 'realm'],
        content: 'The Silver Kingdom is a prosperous land known for its silver mines and its capital city, Argentum.',
        priority: 5,
      },
      {
        id: 'ancient-prophecy',
        keywords: ['prophecy', 'ancient', 'doom'],
        content: 'An ancient prophecy speaks of a "shadow that will consume the light" when the two moons align.',
        priority: 8,
      },
    ];
  }

  /**
   * Scans the provided text for keywords and returns activated lore entries.
   * Entries are sorted by priority (descending) and limited by maxCharacters.
   */
  public scan(text: string, options: LorebookScanOptions = {}): LorebookEntry[] {
    const { maxCharacters = 2000 } = options;
    const activatedEntries: LorebookEntry[] = [];
    const lowerText = text.toLowerCase();

    for (const entry of this.entries) {
      const hasKeyword = entry.keywords.some((keyword) =>
        lowerText.includes(keyword.toLowerCase()),
      );
      if (hasKeyword) {
        activatedEntries.push(entry);
      }
    }

    // Sort by priority (higher first)
    activatedEntries.sort((a, b) => b.priority - a.priority);

    // Limit by character count
    const result: LorebookEntry[] = [];
    let currentChars = 0;

    for (const entry of activatedEntries) {
      if (currentChars + entry.content.length <= maxCharacters) {
        result.push(entry);
        currentChars += entry.content.length;
      }
    }

    return result;
  }

  /**
   * Formats the activated entries for injection into an AI prompt.
   */
  public formatForPrompt(entries: LorebookEntry[]): string {
    if (entries.length === 0) return '';

    const formattedContent = entries
      .map((entry) => `[Lore: ${entry.id}]\n${entry.content}`)
      .join('\n\n');

    return `Relevant World Information:\n${formattedContent}`;
  }
}

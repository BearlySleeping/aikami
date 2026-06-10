// apps/frontend/pwa/src/lib/services/media/sentence_boundary_chunker.ts

/** Configuration options for the SentenceBoundaryChunker. */
export type ChunkerOptions = {
  /** Known abbreviations that should NOT be treated as sentence boundaries (e.g., "Mr.", "Mrs."). */
  abbreviations?: Set<string>;
};

/** Event emitted when a complete sentence is detected. */
export type ChunkEvent = {
  /** The complete sentence text, with whitespace normalized. */
  sentence: string;
};

/**
 * Regex matching a potential sentence boundary: `.`, `!`, or `?` followed
 * by whitespace or end-of-string. Periods that are part of an ellipsis (`..`
 * or `...`) or abbreviation (`Mr.`) are filtered out post-match.
 */
const SENTENCE_BOUNDARY_RE = /[.!?](?=\s|$)/g;

/** Default set of common English abbreviations that should not split sentences. */
const DEFAULT_ABBREVIATIONS = new Set([
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'Prof',
  'Sr',
  'Jr',
  'St',
  'Rd',
  'Ave',
  'Blvd',
  'etc',
  'vs',
  'i.e',
  'e.g',
]);

/**
 * Sentence Boundary Chunker — buffers fragmented SSE text tokens and emits
 * complete sentences as soon as terminal punctuation is detected.
 *
 * Consumes an incoming token stream (received via `feed()`) and fires the
 * `onSentence` callback whenever a sentence boundary is reached. When the
 * stream ends, `close()` flushes any remaining buffered text.
 *
 * This is the first stage of the TTS pipeline — it ensures that the audio
 * engine receives complete sentences rather than fragments, minimizing
 * Time-To-First-Audio (TTFA).
 *
 * ## Boundary rules
 *
 * - `!` and `?` are always sentence boundaries.
 * - `.` is a sentence boundary UNLESS it is part of an ellipsis (`..` or `...`)
 *   or a known abbreviation (`Mr.`, `Dr.`, etc.).
 * - Whitespace (spaces, tabs, newlines) is collapsed to a single space when
 *   normalizing emitted sentences.
 *
 * @example
 * ```typescript
 * const chunker = new SentenceBoundaryChunker();
 * chunker.onSentence(({ sentence }) => console.log(sentence));
 * chunker.feed('Hello');
 * chunker.feed(' there!');
 * // logs: "Hello there!"
 * ```
 */
export class SentenceBoundaryChunker {
  private _buffer = '';
  private _listeners: Array<(event: ChunkEvent) => void> = [];
  private readonly _abbreviations: Set<string>;

  constructor(options: ChunkerOptions = {}) {
    this._abbreviations = options.abbreviations ?? DEFAULT_ABBREVIATIONS;
  }

  /**
   * Register a callback that fires whenever a complete sentence is detected.
   *
   * Multiple listeners can be registered.
   */
  onSentence(listener: (event: ChunkEvent) => void): void {
    this._listeners.push(listener);
  }

  /**
   * Feed a new text token into the chunker.
   *
   * If the accumulated text contains one or more sentence boundaries,
   * completed sentences are emitted via `onSentence` callbacks.
   *
   * @param token — A text fragment from the SSE stream.
   */
  feed(token: string): void {
    if (token.length === 0) {
      return;
    }

    this._buffer += token;
    this._processBuffer();
  }

  /**
   * Signal that the stream has ended.
   *
   * Flushes any remaining buffered text as a final sentence (even without
   * terminal punctuation). If the buffer is empty or contains only whitespace,
   * nothing is emitted.
   */
  close(): void {
    const remaining = this._normalizeWhitespace(this._buffer);
    if (remaining.length > 0) {
      this._emit(remaining);
    }
    this._buffer = '';
  }

  /**
   * Reset the chunker to its initial state.
   *
   * Clears the internal buffer and all registered listeners.
   */
  reset(): void {
    this._buffer = '';
    this._listeners = [];
  }

  /**
   * Check whether a period at the given index is a valid sentence boundary.
   *
   * Returns `false` when the period is part of an ellipsis (`..` or `...`)
   * or a known abbreviation.
   */
  private _isValidBoundary(text: string, periodIndex: number): boolean {
    // Ellipsis check: preceding character is also a dot
    if (periodIndex > 0 && text[periodIndex - 1] === '.') {
      return false;
    }

    // Abbreviation check: preceding word is a known abbreviation
    const precedingWord = this._extractPrecedingWord(text, periodIndex);
    if (precedingWord && this._abbreviations.has(precedingWord)) {
      return false;
    }

    return true;
  }

  /** Process the accumulated buffer for sentence boundaries. */
  private _processBuffer(): void {
    let lastIndex = 0;

    // Reset regex state (it has the `g` flag)
    SENTENCE_BOUNDARY_RE.lastIndex = 0;

    for (;;) {
      const match = SENTENCE_BOUNDARY_RE.exec(this._buffer);
      if (match === null) {
        break;
      }

      const punctIndex = match.index;
      const boundaryEnd = punctIndex + 1;

      // Filter out periods that are ellipsis or abbreviations
      if (this._buffer[punctIndex] === '.' && !this._isValidBoundary(this._buffer, punctIndex)) {
        continue;
      }

      // Extract the complete sentence
      const sentence = this._normalizeWhitespace(this._buffer.slice(lastIndex, boundaryEnd));
      if (sentence.length > 0) {
        this._emit(sentence);
      }

      lastIndex = boundaryEnd;
    }

    // Keep remaining text in buffer
    this._buffer = this._buffer.slice(lastIndex);
  }

  /** Extract the word immediately preceding a punctuation index. */
  private _extractPrecedingWord(text: string, punctIndex: number): string | null {
    let start = punctIndex - 1;
    while (start >= 0 && /[\w.]/.test(text[start])) {
      start--;
    }
    const word = text.slice(start + 1, punctIndex);
    return word.length > 0 ? word : null;
  }

  /**
   * Normalize whitespace: collapse sequences of spaces, tabs, and newlines
   * into a single space, and trim leading/trailing whitespace.
   */
  private _normalizeWhitespace(text: string): string {
    return text.replace(/[\s\n]+/g, ' ').trim();
  }

  /** Fire the onSentence listeners with a completed sentence. */
  private _emit(sentence: string): void {
    const event: ChunkEvent = { sentence };
    for (const listener of this._listeners) {
      listener(event);
    }
  }
}

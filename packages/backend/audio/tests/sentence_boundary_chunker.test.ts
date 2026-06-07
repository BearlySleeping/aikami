// packages/backend/audio/tests/sentence_boundary_chunker.test.ts
import { describe, expect, test } from 'bun:test';
import { SentenceBoundaryChunker } from '../src/lib/sentence_boundary_chunker.ts';

describe('SentenceBoundaryChunker', () => {
  test('emits complete sentence on terminal punctuation (period)', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Hello');
    chunker.feed(' there.');

    expect(sentences).toEqual(['Hello there.']);
  });

  test('emits complete sentence on exclamation mark', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Hello');
    chunker.feed(' there!');

    expect(sentences).toEqual(['Hello there!']);
  });

  test('emits complete sentence on question mark', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('How');
    chunker.feed(' are');
    chunker.feed(' you?');

    expect(sentences).toEqual(['How are you?']);
  });

  test('emits multiple sentences from fragmented input', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Hi');
    chunker.feed(' there!');
    chunker.feed(' How');
    chunker.feed(' are');
    chunker.feed(' you?');

    expect(sentences).toEqual(['Hi there!', 'How are you?']);
  });

  test('ellipsis is NOT a sentence boundary (continues to next punctuation)', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Wait');
    chunker.feed('...');
    chunker.feed(' what?');

    // Ellipsis does not split; only ? ends the sentence
    expect(sentences).toEqual(['Wait... what?']);
  });

  test('mid-sentence ellipsis does not split', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed("I'm");
    chunker.feed(' not...');
    chunker.feed(' sure.');

    expect(sentences).toEqual(["I'm not... sure."]);
  });

  test('flushes remaining buffer on close (trailing text without punctuation)', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Hello');
    chunker.feed(' world');
    chunker.close();

    expect(sentences).toEqual(['Hello world']);
  });

  test('close on empty buffer emits nothing', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.close();

    expect(sentences).toEqual([]);
  });

  test('close after completed sentence emits nothing extra', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Hello.');
    chunker.close();

    expect(sentences).toEqual(['Hello.']);
  });

  test('empty feed emits nothing', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('');
    chunker.feed('');
    chunker.close();

    expect(sentences).toEqual([]);
  });

  test('multiple punctuation marks in one chunk', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Hello! How are you? Good.');

    expect(sentences).toEqual(['Hello!', 'How are you?', 'Good.']);
  });

  test('reset clears buffer without emitting', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Unfinished');
    chunker.feed(' sentence');
    chunker.reset();

    expect(sentences).toEqual([]);
  });

  test('whitespace between sentences is collapsed', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('  Hello   ');
    chunker.feed('  there!   ');

    expect(sentences).toEqual(['Hello there!']);
  });

  test('newlines collapsed to single space', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Hello\n');
    chunker.feed('there.');

    expect(sentences).toEqual(['Hello there.']);
  });

  test('abbreviation period does not split (Mr. Mrs. Dr.)', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('Mr.');
    chunker.feed(' Smith arrived.');

    expect(sentences).toEqual(['Mr. Smith arrived.']);
  });

  test('handles long single-token chunks', () => {
    const chunker = new SentenceBoundaryChunker();
    const sentences: string[] = [];
    chunker.onSentence((event) => sentences.push(event.sentence));

    chunker.feed('The quick brown fox jumps over the lazy dog.');

    expect(sentences).toEqual(['The quick brown fox jumps over the lazy dog.']);
  });
});

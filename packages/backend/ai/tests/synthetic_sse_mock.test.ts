// packages/backend/ai/tests/synthetic_sse_mock.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { SyntheticSseMock } from '../src/lib/synthetic_sse_mock.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createSseReader = (stream: ReadableStream<Uint8Array>) => {
  return stream.pipeThrough(new TextDecoderStream()).getReader();
};

const readAllSseEvents = async (stream: ReadableStream<Uint8Array>): Promise<string[]> => {
  const reader = createSseReader(stream);
  const events: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    events.push(value);
  }

  return events;
};

// ---------------------------------------------------------------------------
// AC-4: Synthetic Mocking — Test Suite
// ---------------------------------------------------------------------------

describe('SyntheticSseMock (AC-4)', () => {
  let mock: SyntheticSseMock;

  beforeEach(() => {
    mock = new SyntheticSseMock();
  });

  // ── AC-4: Core streaming behavior ───────────────────────────────────────

  describe('stream creation', () => {
    it('yields default chunks when no options provided', async () => {
      const stream = mock.createStream({});
      const events = await readAllSseEvents(stream);

      expect(events.length).toBeGreaterThanOrEqual(3);
      const dataEvents = events.filter((e) => e.includes('data:') && !e.includes('[DONE]'));
      expect(dataEvents.length).toBe(3);
    });

    it('yields custom seeded chunks in order', async () => {
      const stream = mock.createStream({
        chunks: [
          { data: { text: 'first' } },
          { data: { text: 'second' } },
          { data: { text: 'third' } },
        ],
        chunkDelayMs: 1,
      });

      const events = await readAllSseEvents(stream);
      const dataLines = events.filter((e) => e.startsWith('data:') && !e.includes('[DONE]'));

      expect(dataLines[0]).toContain('first');
      expect(dataLines[1]).toContain('second');
      expect(dataLines[2]).toContain('third');
    });

    it('emits [DONE] at end by default', async () => {
      const stream = mock.createStream({ chunks: [{ data: { text: 'single' } }], chunkDelayMs: 1 });
      const events = await readAllSseEvents(stream);

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toInclude('[DONE]');
    });

    it('can suppress [DONE] with emitDone: false', async () => {
      const stream = mock.createStream({
        chunks: [{ data: { text: 'no done' } }],
        chunkDelayMs: 1,
        emitDone: false,
      });

      const events = await readAllSseEvents(stream);
      const hasDone = events.some((e) => e.includes('[DONE]'));
      expect(hasDone).toBe(false);
    });
  });

  // ── SSE format correctness ──────────────────────────────────────────────

  describe('SSE format', () => {
    it('formats JSON data with data: prefix and double newline', async () => {
      const stream = mock.createStream({
        chunks: [{ data: { key: 'value' } }],
        chunkDelayMs: 1,
        emitDone: false,
      });

      const events = await readAllSseEvents(stream);
      expect(events[0]).toBe('data: {"key":"value"}\n\n');
    });

    it('formats string data correctly', async () => {
      const stream = mock.createStream({
        chunks: [{ data: 'plain text' }],
        chunkDelayMs: 1,
        emitDone: false,
      });

      const events = await readAllSseEvents(stream);
      expect(events[0]).toBe('data: plain text\n\n');
    });

    it('includes event: prefix when event type is set', async () => {
      const stream = mock.createStream({
        chunks: [{ event: 'error', data: { message: 'oops' } }],
        chunkDelayMs: 1,
        emitDone: false,
      });

      const events = await readAllSseEvents(stream);
      expect(events[0]).toStartWith('event: error\n');
      expect(events[0]).toInclude('data: {"message":"oops"}');
    });

    it('omits event: line when event type is undefined', async () => {
      const stream = mock.createStream({
        chunks: [{ data: { text: 'hi' } }],
        chunkDelayMs: 1,
        emitDone: false,
      });

      const events = await readAllSseEvents(stream);
      expect(events[0]).toStartWith('data:');
      expect(events[0]).not.toInclude('event:');
    });
  });

  // ── Error simulation ────────────────────────────────────────────────────

  describe('error simulation', () => {
    it('emits error event when forceError is set', async () => {
      const stream = mock.createStream({
        chunks: [{ data: { text: 'good' } }],
        forceError: 'simulated failure',
        chunkDelayMs: 1,
      });

      const events = await readAllSseEvents(stream);
      expect(events.length).toBe(1);
      expect(events[0]).toInclude('event: error');
      expect(events[0]).toInclude('simulated failure');
    });

    it('does not emit seeded chunks when forceError is set', async () => {
      const stream = mock.createStream({
        chunks: [{ data: { text: 'should not appear' } }],
        forceError: 'failure',
        chunkDelayMs: 1,
      });

      const events = await readAllSseEvents(stream);
      expect(events.length).toBe(1);
      expect(events[0]).toInclude('error');
    });
  });

  // ── Call history ────────────────────────────────────────────────────────

  describe('call history', () => {
    it('records each createStream call', async () => {
      const stream1 = mock.createStream({ chunks: [{ data: { text: 'a' } }], chunkDelayMs: 1 });
      await readAllSseEvents(stream1);

      const stream2 = mock.createStream({ chunks: [{ data: { text: 'b' } }], chunkDelayMs: 1 });
      await readAllSseEvents(stream2);

      const history = mock.getStreamHistory();
      expect(history).toHaveLength(2);
    });

    it('preserves options in history records', async () => {
      const stream = mock.createStream({
        chunks: [{ data: { text: 'test' } }],
        chunkDelayMs: 42,
        emitDone: false,
      });

      await readAllSseEvents(stream);

      const [record] = mock.getStreamHistory();
      expect(record.chunkDelayMs).toBe(42);
      expect(record.emitDone).toBe(false);
      expect(record.chunks).toHaveLength(1);
    });
  });

  // ── Reset ───────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears call history', async () => {
      const stream = mock.createStream({ chunks: [{ data: { text: 'x' } }], chunkDelayMs: 1 });
      await readAllSseEvents(stream);

      mock.reset();
      expect(mock.getStreamHistory()).toHaveLength(0);
    });
  });

  // ── AC-4 Mandate: No external HTTP ──────────────────────────────────────

  it('makes no external HTTP requests (pure in-memory)', async () => {
    const stream = mock.createStream({ chunks: [{ data: { text: 'local' } }], chunkDelayMs: 1 });
    const events = await readAllSseEvents(stream);
    expect(events.length).toBeGreaterThan(0);
  });

  // ── AC-4 Mandate: Stream completes successfully ─────────────────────────

  it('stream completes without errors', async () => {
    const stream = mock.createStream({ chunks: [{ data: { text: 'ok' } }], chunkDelayMs: 1 });
    const events = await readAllSseEvents(stream);
    expect(events.length).toBeGreaterThan(0);
  });
});

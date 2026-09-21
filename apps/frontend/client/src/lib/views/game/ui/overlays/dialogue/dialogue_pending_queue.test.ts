// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_pending_queue.test.ts
//
// Unit tests for the extracted mid-turn FIFO queue: auto-drain, hold-on-failure,
// explicit retry, and reset.

import { describe, expect, test } from 'bun:test';
import { DialoguePendingQueue } from './dialogue_pending_queue.svelte.ts';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createQueue = () => {
  const delivered: string[] = [];
  let canDrain = true;
  const queue = new DialoguePendingQueue({
    deliver: async (text) => {
      delivered.push(text);
    },
    canDrain: () => canDrain,
  });
  return {
    queue,
    delivered,
    setCanDrain: (value: boolean) => {
      canDrain = value;
    },
  };
};

describe('DialoguePendingQueue', () => {
  test('exposes enqueued entries in FIFO order', () => {
    const { queue } = createQueue();

    queue.enqueue('first');
    queue.enqueue('second');

    expect(queue.length).toBe(2);
    expect(queue.messages).toEqual(['first', 'second']);
  });

  test('drains one entry per completed turn', async () => {
    const { queue, delivered } = createQueue();
    queue.enqueue('a');
    queue.enqueue('b');

    queue.onTurnCompleted(true);
    await tick();

    expect(delivered).toEqual(['a', 'b']);
    expect(queue.length).toBe(0);
  });

  test('waits while the turn is not drainable', async () => {
    const { queue, delivered, setCanDrain } = createQueue();
    setCanDrain(false);
    queue.enqueue('a');

    queue.onTurnCompleted(true);
    await tick();
    expect(delivered).toEqual([]);

    setCanDrain(true);
    queue.retry();
    await tick();
    expect(delivered).toEqual(['a']);
  });

  test('a failed turn holds the queue until an explicit retry', async () => {
    const { queue, delivered } = createQueue();
    queue.enqueue('a');

    queue.onTurnCompleted(false);
    await tick();
    expect(delivered).toEqual([]);
    expect(queue.messages).toEqual(['a']);

    queue.retry();
    await tick();
    expect(delivered).toEqual(['a']);
  });

  test('hold stops auto-drain; reset clears and re-enables', async () => {
    const { queue, delivered } = createQueue();
    queue.enqueue('a');
    queue.hold();

    queue.onTurnCompleted(true);
    await tick();
    expect(delivered).toEqual([]);

    queue.reset();
    expect(queue.length).toBe(0);

    queue.enqueue('b');
    queue.onTurnCompleted(true);
    await tick();
    expect(delivered).toEqual(['b']);
  });
});

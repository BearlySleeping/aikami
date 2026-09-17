// scripts/src/lib/agents/contract_pipeline/worker_delivery.test.ts
import { describe, expect, it } from 'bun:test';
import type { DeliverySurface } from './worker_delivery.ts';
import { deliverTaskText } from './worker_delivery.ts';

const snapshot = (composer: string): string =>
  ['────────────────', composer, '────────────────', '/repo'].join('\n');

const surfaceWith = (options: {
  status: () => string | undefined;
  paneText: () => string | null;
  onEnter?: () => void;
}): { surface: DeliverySurface; enterCount: () => number } => {
  let enters = 0;
  return {
    surface: {
      waitForAgentStatus: async () => true,
      getAgentStatus: async () => options.status(),
      readPaneText: async () => options.paneText(),
      sendText: async () => {},
      pressEnter: async () => {
        enters++;
        options.onEnter?.();
      },
      isCommandRunning: async () => true,
      sleep: async () => {},
    },
    enterCount: () => enters,
  };
};

describe('deliverTaskText retry safety', () => {
  it('presses Enter only while the idle composer still contains the task', async () => {
    const text = 'Implement the requested contract.';
    let status = 'idle';
    const fixture = surfaceWith({
      status: () => status,
      paneText: () => snapshot(text),
      onEnter: () => {
        status = 'working';
      },
    });

    const result = await deliverTaskText(fixture.surface, { paneId: 'pane-1', text });

    expect(result).toEqual({ attempted: true, acknowledged: true });
    expect(fixture.enterCount()).toBe(1);
  });

  it('retries Enter only after the first press left the composer unchanged', async () => {
    // herdr's `pane send-keys Enter` is unreliable: the first press can be
    // dropped. The retry must be driven by evidence (composer still holds our
    // text, agent still idle), not by a blind multi-press storm.
    const text = 'Implement the requested contract.';
    let presses = 0;
    const fixture = surfaceWith({
      status: () => 'idle',
      paneText: () => (presses < 2 ? snapshot(text) : snapshot('')),
      onEnter: () => {
        presses++;
      },
    });

    const result = await deliverTaskText(fixture.surface, { paneId: 'pane-1', text });

    expect(result).toEqual({ attempted: true, acknowledged: true });
    expect(fixture.enterCount()).toBe(2);
  });

  it('does not submit unrelated composer input', async () => {
    const fixture = surfaceWith({
      status: () => 'idle',
      paneText: () => snapshot('unrelated human input'),
    });

    const result = await deliverTaskText(fixture.surface, {
      paneId: 'pane-1',
      text: 'Implement the requested contract.',
    });

    expect(result.acknowledged).toBe(false);
    expect(fixture.enterCount()).toBe(0);
  });

  it('does not submit a composer that mixes the task with unrelated input', async () => {
    const text = 'Implement the requested contract.';
    const fixture = surfaceWith({
      status: () => 'idle',
      paneText: () => snapshot(`human prefix ${text}`),
    });

    await deliverTaskText(fixture.surface, { paneId: 'pane-1', text });

    expect(fixture.enterCount()).toBe(0);
  });

  it('stops without Enter for unreadable panes or unexpected status', async () => {
    for (const fixture of [
      surfaceWith({ status: () => 'idle', paneText: () => null }),
      surfaceWith({ status: () => 'unknown', paneText: () => snapshot('task') }),
    ]) {
      const result = await deliverTaskText(fixture.surface, { paneId: 'pane-1', text: 'task' });
      expect(result.acknowledged).toBe(false);
      expect(fixture.enterCount()).toBe(0);
    }
  });
});

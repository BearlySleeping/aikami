// scripts/src/lib/agents/subagents/pane_completion.ts

import { herdr } from '../../herdr/session.ts';

/** Quiet completion releases only our hook instead of emitting a Done transition. */
export const completionPaneArgs = (options: {
  paneId: string;
  message: string;
  alerts?: boolean;
}): string[] => {
  if (!options.alerts) {
    return [
      'pane',
      'release-agent',
      options.paneId,
      '--source',
      'aikami-subagent',
      '--agent',
      'pi',
    ];
  }
  return [
    'pane',
    'report-agent',
    options.paneId,
    '--source',
    'aikami-subagent',
    '--agent',
    'pi',
    '--state',
    'idle',
    '--message',
    options.message.slice(0, 120),
  ];
};

/** Await hook release before supervisor exit; result delivery to the captain is separate. */
export const settleSubagentPane = async (options: {
  paneId?: string;
  message: string;
  alerts?: boolean;
  runHerdr?: (args: string[]) => Promise<unknown>;
}): Promise<void> => {
  if (!options.paneId) {
    return;
  }
  try {
    const args = completionPaneArgs({ ...options, paneId: options.paneId });
    const runHerdr = options.runHerdr ?? ((command) => herdr(command, { timeoutMs: 5000 }));
    await runHerdr(args);
  } catch {
    // UI cleanup is best-effort. Never fall back to idle: that emits an alert.
  }
};

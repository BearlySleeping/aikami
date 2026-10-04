// scripts/src/lib/agents/subagents/pane_completion.ts

import { logger } from '$logger';
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
  runHerdr?: (args: string[]) => Promise<{ code: number; stderr: string }>;
}): Promise<boolean> => {
  if (!options.paneId) {
    return true;
  }
  try {
    const args = completionPaneArgs({ ...options, paneId: options.paneId });
    const runHerdr = options.runHerdr ?? ((command) => herdr(command, { timeoutMs: 5000 }));
    const result = await runHerdr(args);
    if (result.code !== 0) {
      throw new Error(`Herdr exited ${result.code}: ${result.stderr}`);
    }
    return true;
  } catch (error) {
    // UI cleanup is best-effort. Never fall back to idle: that emits an alert.
    logger.warn('Subagent pane settlement failed', { paneId: options.paneId, error });
    return false;
  }
};

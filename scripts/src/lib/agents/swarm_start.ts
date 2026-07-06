// scripts/src/lib/agents/swarm_start.ts
/**
 * Swarm start CLI — accepts a task payload and executes through the swarm.
 *
 * Usage: `bun run scripts -- swarm:start <task-payload.json>`
 *
 * The payload JSON must conform to TaskPayload:
 * ```json
 * {
 *   "taskId": "C-300",
 *   "steps": [
 *     {
 *       "stepIndex": 0,
 *       "agent": "architect",
 *       "command": "bun --version",
 *       "complianceSignature": "\\\\d+\\\\.\\\\d+\\\\.\\\\d+"
 *     }
 *   ]
 * }
 * ```
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeTask, initializeSwarm, snapshotState } from './swarm_director';
import type { TaskPayload } from './types';

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const payloadPath = args[0];

  if (!payloadPath) {
    console.error('Usage: bun run scripts -- swarm:start <task-payload.json>');
    console.error('');
    console.error('Payload format:');
    console.error('  {');
    console.error('    "taskId": "mytask",');
    console.error('    "steps": [');
    console.error('      {');
    console.error('        "stepIndex": 0,');
    console.error('        "agent": "architect",');
    console.error('        "command": "cd /home/user/project && echo done",');
    console.error('        "complianceSignature": "done"');
    console.error('      }');
    console.error('    ]');
    console.error('  }');
    process.exit(1);
  }

  const fullPath = resolve(payloadPath);
  let payload: TaskPayload;

  try {
    const raw = readFileSync(fullPath, 'utf-8');
    payload = JSON.parse(raw) as TaskPayload;

    // Convert complianceSignature strings in JSON to RegExp objects
    payload.steps = payload.steps.map((step) => ({
      ...step,
      complianceSignature:
        typeof step.complianceSignature === 'string'
          ? // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            new RegExp(step.complianceSignature as unknown as string)
          : step.complianceSignature,
    }));
  } catch (error) {
    console.error(`Failed to parse payload: ${error}`);
    process.exit(1);
  }

  if (!payload.taskId || !Array.isArray(payload.steps) || payload.steps.length === 0) {
    console.error('Invalid payload: must have taskId and non-empty steps array');
    process.exit(1);
  }

  console.log('[swarm:start:loading]', { taskId: payload.taskId, steps: payload.steps.length });

  // Initialize workspace
  const state = await initializeSwarm({
    projectRoot: process.cwd(),
  });

  // Execute the task pipeline
  try {
    await executeTask({ payload, state });
    console.log(`\n✅ Task "${payload.taskId}" completed successfully\n`);
  } catch (error) {
    console.error(`\n❌ Task "${payload.taskId}" failed: ${error}\n`);

    // Take snapshot for diagnostics
    const snapshot = await snapshotState();
    for (const [role, agent] of Object.entries(snapshot.agents)) {
      console.error(`  ${role}: ${agent.status}`);
    }

    process.exit(1);
  }
};

main().catch((error) => {
  console.error('swarm:start:failed', error);
  process.exit(1);
});

// scripts/src/lib/agents/swarm_start.ts
/**
 * Swarm start CLI — accepts a task payload and executes through the swarm.
 *
 * Usage:
 *   bun swarm:start <payload.json>           # Legacy CLI mode
 *   bun swarm:start <payload.json> --socket  # C-311 socket mode
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HerdrSocketClient } from '../herdr/socket_client';
import { executeTask, executeTaskSocket, initializeSwarm, snapshotState } from './swarm_director';
import type { TaskPayload } from './types';

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const useSocket = args.includes('--socket');
  const filteredArgs = args.filter((a) => a !== '--socket');
  const payloadPath = filteredArgs[0];

  if (!payloadPath) {
    console.error('Usage: bun swarm:start <task-payload.json> [--socket]');
    process.exit(1);
  }

  const fullPath = resolve(payloadPath);
  let payload: TaskPayload;

  try {
    const raw = readFileSync(fullPath, 'utf-8');
    payload = JSON.parse(raw) as TaskPayload;
    payload.steps = payload.steps.map((step) => ({
      ...step,
      complianceSignature:
        typeof step.complianceSignature === 'string'
          ? new RegExp(step.complianceSignature as unknown as string)
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

  const taskId = payload.taskId;
  console.log('[swarm:start:loading]', {
    taskId,
    steps: payload.steps.length,
    mode: useSocket ? 'socket' : 'cli',
  });

  const state = await initializeSwarm({
    projectRoot: process.cwd(),
    taskId,
  });

  try {
    if (useSocket) {
      const socketClient = HerdrSocketClient.create({});
      await executeTaskSocket({
        payload,
        state,
        socketClient,
        tier: (payload as Record<string, unknown>).tier as string | undefined,
      });
    } else {
      await executeTask({ payload, state });
    }
    console.log(`\n✅ Task "${taskId}" completed successfully\n`);
  } catch (error) {
    console.error(`\n❌ Task "${taskId}" failed: ${error}\n`);
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

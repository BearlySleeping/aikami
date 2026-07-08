// scripts/src/lib/agents/swarm_start.ts
/**
 * Swarm start CLI — accepts a task payload and executes through the swarm.
 *
 * Usage:
 *   bun swarm:start <payload.json>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HerdrSocketClient } from '../herdr/socket_client';
import { executeTaskSocket, initializeSwarm, snapshotState } from './swarm_director';
import type { TaskPayload } from './types';

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const payloadPath = args.find((a) => !a.startsWith('--'));

  if (!payloadPath) {
    console.error('Usage: bun swarm:start <task-payload.json>');
    process.exit(1);
  }

  const fullPath = resolve(payloadPath);
  let payload: TaskPayload;

  try {
    const raw = readFileSync(fullPath, 'utf-8');
    payload = JSON.parse(raw) as TaskPayload;
  } catch (error) {
    console.error(`Failed to parse payload: ${error}`);
    process.exit(1);
  }

  if (!payload.taskId) {
    console.error('Invalid payload: must have taskId');
    process.exit(1);
  }

  const extra = payload as Record<string, unknown>;
  const taskId = payload.taskId;
  const tier = (extra.tier as string) ?? 'flash';
  const skipReview = (extra.skipReview as boolean) ?? false;
  const resume = (extra.resume as boolean) ?? true;

  console.log('[swarm:start:loading]', { taskId, tier, skipReview, resume });

  const state = await initializeSwarm({
    projectRoot: process.cwd(),
    taskId,
  });

  try {
    const socketClient = HerdrSocketClient.create({});
    await executeTaskSocket({
      payload,
      state,
      socketClient,
      tier,
      skipReview,
      resume,
    });
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

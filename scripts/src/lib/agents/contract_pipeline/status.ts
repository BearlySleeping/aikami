#!/usr/bin/env bun
// scripts/src/lib/agents/contract_pipeline/status.ts
// Quick status check for active or recent contract pipelines

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLockMetadata } from './manifest_store.ts';

const repoRoot = process.cwd();
const runsDir = join(repoRoot, '.pi/contract-runs');

const elapsed = (isoTime: string): string => {
  const ms = Date.now() - new Date(isoTime).getTime();
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s ago`;
  }
  if (ms < 3600_000) {
    return `${Math.round(ms / 60_000)}m ago`;
  }
  if (ms < 86400_000) {
    return `${Math.round(ms / 3600_000)}h ago`;
  }
  return `${Math.round(ms / 86400_000)}d ago`;
};

const main = async (): Promise<void> => {
  if (!existsSync(runsDir)) {
    console.log('No contract runs directory found.');
    return;
  }

  const runs = readdirSync(runsDir)
    .filter((f) => f.startsWith('run-'))
    .sort()
    .reverse()
    .slice(0, 10); // Last 10 runs

  if (runs.length === 0) {
    console.log('No contract runs found.');
    return;
  }

  console.log('\n🔍 Recent Contract Runs (last 10):\n');

  for (const runId of runs) {
    const manifestPath = join(runsDir, runId, 'manifest.json');
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        contractId?: string;
        currentStage?: string;
        lastUpdated?: string;
      };

      const stage = manifest.currentStage ?? '?';
      const updated = manifest.lastUpdated ? elapsed(manifest.lastUpdated) : '?';
      let stageIcon: string;
      if (stage === 'merged') {
        stageIcon = '✅';
      } else if (stage === 'blocked') {
        stageIcon = '🚫';
      } else if (stage === 'review') {
        stageIcon = '👀';
      } else if (stage === 'verify') {
        stageIcon = '🔍';
      } else if (stage === 'implement') {
        stageIcon = '⚙️';
      } else if (stage === 'critique') {
        stageIcon = '📝';
      } else if (stage === 'write_contract') {
        stageIcon = '✍️';
      } else {
        stageIcon = '❓';
      }

      console.log(`${stageIcon} ${manifest.contractId ?? '?'} — ${stage} (${updated})`);
    } catch {
      // Skip malformed manifests
    }
  }

  // Check for active locks
  console.log('\n🔒 Active Locks:\n');
  const locks = readdirSync(runsDir)
    .filter((f) => f.startsWith('lock_'))
    .map((f) => f.replace('lock_', '').replace('.json', ''));

  if (locks.length === 0) {
    console.log('No active locks.');
  } else {
    for (const contractId of locks) {
      const metadata = readLockMetadata({ contractId, cwd: repoRoot });
      if (!metadata) {
        console.log(`  ⚠️  ${contractId} (invalid lock)`);
        continue;
      }
      const age = Math.round((Date.now() - new Date(metadata.createdAt).getTime()) / 1000);
      let ageStr: string;
      if (age < 60) {
        ageStr = `${age}s`;
      } else if (age < 3600) {
        ageStr = `${Math.round(age / 60)}m`;
      } else {
        ageStr = `${Math.round(age / 3600)}h`;
      }
      console.log(`  🔴 ${contractId} (PID ${metadata.pid}, locked ${ageStr} ago)`);
    }
  }

  console.log();
};

await main();

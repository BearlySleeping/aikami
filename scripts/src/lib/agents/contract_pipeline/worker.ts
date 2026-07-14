#!/usr/bin/env bun
// scripts/src/lib/agents/contract_pipeline/worker.ts
// biome-ignore-all lint/style/useNamingConvention: environment variable keys are external process contracts
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { captureGitState } from './git_state.ts';
import { writeStageResult } from './stage_result.ts';
import { roleForStage } from './stage_runner.ts';
import type { ContractPipelineStage, StageUsage } from './types.ts';

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const atomicWrite = (options: { path: string; content: string }): void => {
  mkdirSync(dirname(options.path), { recursive: true });
  const temporaryPath = `${options.path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, options.content);
  renameSync(temporaryPath, options.path);
};

const contractHash = (contractPath: string): string =>
  existsSync(contractPath)
    ? createHash('sha256').update(readFileSync(contractPath)).digest('hex')
    : '';

const activeTools = (role: string): string[] | undefined => {
  if (role === 'writer') {
    return [
      'read',
      'grep',
      'find',
      'ls',
      'edit',
      'write',
      'contract_scan_backlog',
      'contract_generate',
      'contract_stage_complete',
    ];
  }
  if (role === 'critic') {
    return ['read', 'grep', 'find', 'ls', 'contract_scan_backlog', 'contract_stage_complete'];
  }
  return undefined;
};

/** Extract a label from the contract path for display. */
const contractLabel = (path: string): string => {
  const match = path.match(/(C-\d+|MIG-\d+)/);
  return match?.[0] ?? path.split('/').pop() ?? path;
};

/** Format stage usage as a one-line summary. */
const usageSummary = (usage: StageUsage): string => {
  const parts: string[] = [];
  if (usage.turns) {
    parts.push(`${usage.turns} turn${usage.turns !== 1 ? 's' : ''}`);
  }
  if (usage.model) {
    parts.push(usage.model);
  }
  if (usage.inputTokens || usage.outputTokens) {
    const total = usage.inputTokens + usage.outputTokens;
    parts.push(`${total.toLocaleString()} tokens`);
  }
  if (usage.cost) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'no model activity';
};

const main = async (): Promise<void> => {
  const runId = argument('--run-id');
  const stage = argument('--stage') as ContractPipelineStage;
  const attempt = Number(argument('--attempt'));
  const contractPath = argument('--contract');
  const promptPath = argument('--prompt');
  const resultPath = argument('--result');
  const usagePath = argument('--usage');
  const role = roleForStage(stage);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Invalid attempt: ${attempt}`);
  }

  const label = contractLabel(contractPath);
  const runDirectory = dirname(resultPath).replace('/stages', '');

  // Write Pi JSON events to a debug log, not the Herdr pane.
  const workerLogPath = join(runDirectory, 'worker', `${stage}-${attempt}.log`);
  mkdirSync(dirname(workerLogPath), { recursive: true });
  const workerLog = createWriteStream(workerLogPath, 'utf-8');

  process.stdout.write(`${role} starting for ${label} (attempt ${attempt})\n`);
  process.stdout.write(`  Log: ${workerLogPath}\n`);

  const args = ['--mode', 'json', '-p', '--no-session', '--append-system-prompt', promptPath];
  const tools = activeTools(role);
  if (tools) {
    args.push('--tools', tools.join(','));
  }
  args.push(
    `Execute only the ${role} stage for ${contractPath}. Finish through contract_stage_complete.`,
  );

  const usage: StageUsage = {
    model: '',
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: 0,
  };
  const processEnvironment = {
    ...process.env,
    CONTRACT_PIPELINE_RUN_ID: runId,
    CONTRACT_PIPELINE_ROLE: role,
    CONTRACT_PIPELINE_STAGE: stage,
    CONTRACT_PIPELINE_ATTEMPT: String(attempt),
    CONTRACT_PIPELINE_CONTRACT_PATH: contractPath,
    CONTRACT_PIPELINE_RESULT_PATH: resultPath,
  };

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn('pi', args, {
      cwd: process.cwd(),
      env: processEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let outputBuffer = '';
    let lastProgressTurn = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerLog.write(text);
      outputBuffer += text;
      const lines = outputBuffer.split('\n');
      outputBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const event = JSON.parse(line) as {
            type?: string;
            message?: {
              role?: string;
              model?: string;
              usage?: {
                input?: number;
                output?: number;
                cacheRead?: number;
                cacheWrite?: number;
                totalTokens?: number;
                cost?: { total?: number };
              };
            };
          };
          if (event.type !== 'message_end' || event.message?.role !== 'assistant') {
            continue;
          }
          const eventUsage = event.message.usage;
          usage.turns += 1;
          usage.model = event.message.model ?? usage.model;
          usage.inputTokens += eventUsage?.input ?? 0;
          usage.outputTokens += eventUsage?.output ?? 0;
          usage.cacheReadTokens += eventUsage?.cacheRead ?? 0;
          usage.cacheWriteTokens += eventUsage?.cacheWrite ?? 0;
          usage.totalTokens = eventUsage?.totalTokens ?? usage.totalTokens;
          usage.cost += eventUsage?.cost?.total ?? 0;

          if (usage.turns > lastProgressTurn + 4) {
            lastProgressTurn = usage.turns;
            process.stdout.write(
              `  ${usage.turns} turns, ${usage.model}, ${(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens\n`,
            );
          }
        } catch {
          // Non-JSON output is preserved in the log but never parsed as completion.
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      workerLog.write(`[stderr] ${chunk.toString()}`);
    });

    child.once('error', () => resolve(1));
    child.once('close', (code) => resolve(code ?? 1));
  });

  workerLog.end();

  atomicWrite({ path: usagePath, content: JSON.stringify(usage, undefined, 2) });

  if (!existsSync(resultPath)) {
    const gitState = captureGitState(process.cwd());
    writeStageResult({
      resultPath,
      result: {
        runId,
        stage: role,
        attempt,
        status: 'failed',
        summary: `Pi worker exited with code ${exitCode} without contract_stage_complete.`,
        findings: ['No structured completion artifact was produced.'],
        filesTouched: [],
        evidence: [],
        contractHash: contractHash(contractPath),
        diffHash: gitState.fingerprint,
      },
    });
    process.stdout.write(`${role} failed — exit code ${exitCode}, no completion artifact.\n`);
    process.stdout.write(`  Full output: ${workerLogPath}\n`);
  } else {
    process.stdout.write(`${role} completed — ${usageSummary(usage)}\n`);
    process.stdout.write(`  Full output: ${workerLogPath}\n`);
  }

  process.exitCode = exitCode;
};

await main();

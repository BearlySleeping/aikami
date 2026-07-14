#!/usr/bin/env bun
// scripts/src/lib/agents/contract_generator.ts
import { resolveContract } from './contract_pipeline/contract_resolver.ts';

const target = process.argv[2];
if (!target) {
  console.error('Usage: bun run contract:generate C-XXX');
  process.exit(1);
}

const contract = resolveContract({ target, repoRoot: process.cwd() });
console.log(`${contract.id}: ${contract.path} (${contract.status})`);

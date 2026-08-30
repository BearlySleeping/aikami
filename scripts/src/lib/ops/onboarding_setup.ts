// scripts/src/lib/ops/onboarding_setup.ts
//
// C-449 AC-4: First-run onboarding script for new contributors.
// Walks through:
//   1. Creating a Cloudflare API token with the right scopes
//   2. Generating/obtaining an age key for SOPS
//   3. Decrypting secrets/ locally via the existing decrypt_secrets.ts
//
// Usage:
//   bun run scripts/src/lib/ops/onboarding_setup.ts
//
// This script is interactive and will prompt for input.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────────

const printHeader = (text: string): void => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${text}`);
  console.log('='.repeat(60));
};

const printStep = (num: number, text: string): void => {
  console.log(`\n  Step ${num}: ${text}`);
  console.log(`  ${'-'.repeat(text.length + 10)}`);
};

const confirmStep = async (promptText: string): Promise<boolean> => {
  console.log(`\n  ${promptText} (y/N)`);
  // Read a single line from stdin using the standard Node.js stream API
  const result = await new Promise<string>((resolve) => {
    process.stdin.once('data', (data: Buffer) => {
      resolve(data.toString('utf8'));
    });
  });
  const answer = result.trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
};

const checkCommand = (cmd: string): boolean => {
  const result = Bun.spawnSync([cmd, '--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return result.exitCode === 0;
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  printHeader('Aikami — First-Run Onboarding Setup');
  console.log('\n  This script will help you configure your local development');
  console.log('  environment with Cloudflare and SOPS access.\n');
  console.log('  Prerequisites:');
  console.log('    • A GitHub account with access to the Aikami repository');
  console.log("    • Bun installed (you're running this, so that's done!)");
  console.log('    • A Cloudflare account (free tier works)');

  // ── Step 1: Check prerequisites ──────────────────────────────────────
  printStep(1, 'Checking prerequisites');

  const hasSops = checkCommand('sops');
  const hasAge = checkCommand('age');

  if (!hasSops) {
    console.log('  ⚠️  `sops` not found. Install it:');
    console.log('     macOS: brew install sops');
    console.log('     Linux: https://github.com/getsops/sops/releases');
    console.log('     Windows: scoop install sops');
  } else {
    console.log('  ✓ `sops` is installed');
  }

  if (!hasAge) {
    console.log('  ⚠️  `age` not found. Install it:');
    console.log('     macOS: brew install age');
    console.log('     Linux: apt install age');
    console.log('     Windows: scoop install age');
  } else {
    console.log('  ✓ `age` is installed');
  }

  if (!hasSops || !hasAge) {
    const ok = await confirmStep('Install the missing tools and continue?');
    if (!ok) {
      console.log('\n  ❌ Please install the missing tools and re-run this script.');
      process.exit(1);
    }
  }

  // ── Step 2: Cloudflare API token ─────────────────────────────────────
  printStep(2, 'Cloudflare API token');

  const cfTokenPath = join(homedir(), '.cloudflare', 'api-token');
  const cfConfigPath = join(homedir(), '.cloudflare', 'config.json');

  if (existsSync(cfTokenPath) || existsSync(cfConfigPath)) {
    console.log('  ✓ Cloudflare credentials found.');
    const redo = await confirmStep('Create a new Cloudflare API token anyway?');
    if (!redo) {
      console.log('  → Using existing Cloudflare credentials.');
    } else {
      await cloudflareTokenGuide();
    }
  } else {
    await cloudflareTokenGuide();
  }

  // ── Step 3: age key for SOPS ─────────────────────────────────────────
  printStep(3, 'age key for SOPS decryption');

  const ageKeyPath = join(homedir(), '.config', 'sops', 'age', 'keys.txt');
  const ageKeyPathOld = join(homedir(), '.age', 'keys.txt');

  if (existsSync(ageKeyPath) || existsSync(ageKeyPathOld)) {
    console.log('  ✓ age key found.');
    const redo = await confirmStep('Generate a new age key anyway?');
    if (!redo) {
      console.log('  → Using existing age key.');
    } else {
      await generateAgeKey();
    }
  } else {
    await generateAgeKey();
  }

  // ── Step 4: Decrypt secrets ──────────────────────────────────────────
  printStep(4, 'Decrypt secrets');

  console.log("\n  We'll now decrypt the secrets/ directory for local development.");
  console.log('  This requires a Cloudflare API token and an age key (steps 2 & 3).\n');

  const doDecrypt = await confirmStep('Proceed with decryption?');
  if (!doDecrypt) {
    console.log('\n  ⚠️  Skipping decryption. Run manually later:');
    console.log('     bun run decrypt-secrets --mode staging');
    process.exit(0);
  }

  console.log('\n  Decrypting secrets for staging mode...\n');

  const decryptResult = Bun.spawnSync(['bun', 'run', 'decrypt-secrets', '--mode', 'staging'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: process.cwd(),
  });

  if (decryptResult.exitCode === 0) {
    console.log('\n  ✓ Secrets decrypted successfully.');
    console.log('\n  Your local environment is ready!');
    console.log('\n  Next steps:');
    console.log('    1. Run `bun run dev` to start the development server');
    console.log('    2. Or run `moon run client:dev` for the client app');
    console.log('    3. Check CONTRIBUTING.md for more details');
  } else {
    console.error('\n  ❌ Decryption failed. Check the error above.');
    console.error('  Common issues:');
    console.error('    • Cloudflare API token missing or invalid');
    console.error('    • age key not added to SOPS config');
    console.error('    • Missing secrets/ directory');
    process.exit(1);
  }
};

const cloudflareTokenGuide = async (): Promise<void> => {
  console.log('\n  To create a Cloudflare API token:');
  console.log('    1. Go to https://dash.cloudflare.com/profile/api-tokens');
  console.log('    2. Click "Create Token" → "Create Custom Token"');
  console.log('    3. Give it a name like "Aikami Local Dev"');
  console.log('    4. Under Permissions, add:');
  console.log('       • Account > Cloudflare Workers > Edit');
  console.log('       • Account > D1 > Edit');
  console.log('       • Account > R2 > Edit');
  console.log('    5. Under Account Resources, select your account');
  console.log('    6. Create the token and copy it');
  console.log('\n  Then save it to ~/.cloudflare/api-token or configure the');
  console.log('  CLOUDFLARE_API_TOKEN environment variable.\n');

  const done = await confirmStep('Have you created and saved your Cloudflare API token?');
  if (!done) {
    console.log('\n  ⚠️  Please create the token and re-run this script.');
    process.exit(1);
  }
};

const generateAgeKey = async (): Promise<void> => {
  console.log('\n  Generating a new age key for SOPS...\n');

  // Create parent directory for the key file
  const ageDir = join(homedir(), '.config', 'sops', 'age');
  if (!existsSync(ageDir)) {
    mkdirSync(ageDir, { recursive: true });
  }

  const ageKeyPath = join(ageDir, 'keys.txt');
  const result = Bun.spawnSync(['age-keygen', '-o', ageKeyPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.exitCode !== 0) {
    console.error('  ❌ Failed to generate age key. Is `age` installed?');
    process.exit(1);
  }

  // Read back the generated key to extract the public key
  const keyContent = readFileSync(ageKeyPath, 'utf8');
  const pubKeyMatch = keyContent.match(/# public key: (age1[a-z0-9]+)/);
  const pubKey = pubKeyMatch?.[1];

  if (pubKey) {
    console.log(`  Your public key: ${pubKey}`);
    console.log('\n  ⚠️  IMPORTANT: Share this public key with the team so they can');
    console.log('  add it to the SOPS encryption configuration. Without it, you');
    console.log("  won't be able to decrypt secrets/ locally.");
    console.log(`\n  The private key was saved to ${ageKeyPath}\n`);
  }

  const done = await confirmStep('Have you saved the key and shared your public key?');
  if (!done) {
    console.log('\n  ⚠️  Make sure to save the key before continuing.');
  }
};

await main();

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline';

const rl = createInterface({ input, output });

const EXPORTS: Record<string, { name: string; platform: string }> = {
  linux: { name: 'Linux', platform: 'Linux/X11' },
  web: { name: 'Web', platform: 'Web' },
  windows: { name: 'Windows', platform: 'Windows' },
  macos: { name: 'macOS', platform: 'macOS' },
};

const args = process.argv.slice(2);
const isAll = args.includes('--all');
const isList = args.includes('--list');
const isClean = args.includes('--clean');
const isServe = args.includes('--serve');
const selected = args
  .filter((a) => a.startsWith('--'))
  .filter((a) => !['--all', '--list', '--clean', '--serve'].includes(a))
  .map((a) => a.replace('--', ''));

function getPlatform(): string {
  const p = process.platform;
  if (p === 'linux') return 'linux';
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}

async function question(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(promptText, resolve);
  });
}

function trySystemGodot(): string | null {
  try {
    const out = execSync('which godot', { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getGodotBinary(): string {
  return trySystemGodot() || 'godot';
}

function exportPlatform(key: string): boolean {
  const exp = EXPORTS[key];
  const outDir = `dist/${key}`;
  const bin = getGodotBinary();

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  execSync(`${bin} --headless --import`, { stdio: 'inherit' });

  if (key === 'web') {
    execSync(`${bin} --headless --export-release Web ${outDir}/index.html`, {
      stdio: 'inherit',
    });
  } else {
    const outPack = `${outDir}/game.pck`;
    execSync(`${bin} --headless --export-pack "${exp.name}" ${outPack}`, {
      stdio: 'inherit',
    });

    fs.copyFileSync('project.godot', `${outDir}/project.godot`);
    fs.cpSync('.godot', `${outDir}/.godot`, { recursive: true });
    fs.cpSync('src', `${outDir}/src`, { recursive: true });
    fs.copyFileSync(bin, `${outDir}/game`);
    fs.chmodSync(`${outDir}/game`, 0o755);
  }
  return true;
}

async function main() {
  if (isClean) {
    if (fs.existsSync('dist')) {
      fs.rmSync('dist', { recursive: true });
    }
    return;
  }

  if (isList) {
    const bin = getGodotBinary();
    for (const key of Object.keys(EXPORTS)) {
    }
    return;
  }

  if (isServe) {
    const outDir = 'dist/web';
    if (!fs.existsSync(outDir)) {
      return;
    }
    spawn('bun', ['run', 'scripts/serve.ts'], { stdio: 'inherit' });
    return;
  }

  let toExport = selected;
  if (toExport.length === 0 && !isAll) {
    const defaultPlat = getPlatform();
    const answer = await question(`Export? [Y] ${defaultPlat}+web, [W] web, [A] all: `);

    if (answer.toLowerCase() === 'w') {
      toExport = ['web'];
    } else if (answer.toLowerCase() === 'y' || answer === '') {
      toExport = [defaultPlat, 'web'];
    } else if (answer.toLowerCase() === 'a') {
      toExport = Object.keys(EXPORTS);
    }
  }

  if (isAll) {
    toExport = Object.keys(EXPORTS);
  }

  for (const key of toExport) {
    exportPlatform(key);
  }
  rl.close();
}

main().catch(console.error);

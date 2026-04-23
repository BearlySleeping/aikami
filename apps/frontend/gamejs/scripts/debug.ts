const args = process.argv.slice(2);
let mode = 'development';
const godotArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode' && args[i + 1]) {
    mode = args[i + 1];
  } else if (args[i].startsWith('--mode=')) {
    mode = args[i].replace('--mode=', '');
  } else {
    godotArgs.push(args[i]);
  }
}

const validModes = ['development', 'emulator', 'production'];
if (!validModes.includes(mode)) {
  console.error('Invalid mode. Valid modes:', validModes.join(', '));
  process.exit(1);
}

const envFile = Bun.file('.env.' + mode);
if (!(await envFile.exists())) {
  console.error('Environment file not found:', '.env.' + mode);
  process.exit(1);
}

console.log('Loading environment:', mode);
await Bun.write(Bun.file('.env'), envFile);
console.log('Copied .env.' + mode, 'to .env');

const envContent = await Bun.file('.env').text();
const lines = envContent.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
lines.forEach((line) => console.log(' ', line));

console.log('\nBuilding...');

const build = Bun.spawn(['godot-ts', 'build'], { stdout: 'pipe', stderr: 'pipe' });
const [buildOut, buildErr] = await Promise.all([build.stdout.text(), build.stderr.text()]);
console.log(buildOut);
console.error(buildErr);
const buildCode = await build.exited;
if (buildCode !== 0) {
  console.error('Build failed with code:', buildCode);
  process.exit(buildCode);
}

console.log('\nLaunching Godot...', ...godotArgs);

const godot = Bun.spawn(['godot', ...godotArgs], { stdout: 'inherit', stderr: 'inherit' });
const exitCode = await godot.exited;
process.exit(exitCode ?? 0);

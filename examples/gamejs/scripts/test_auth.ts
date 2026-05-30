const envFile = Bun.file('.env.emulator');
if (!(await envFile.exists())) {
  console.error('Environment file not found: .env.emulator');
  process.exit(1);
}

console.log('Loading environment: emulator');
await Bun.write(Bun.file('.env'), envFile);
console.log('Copied .env.emulator to .env');

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

console.log('\nRunning test scene...');

const godot = Bun.spawn(['godot', '--scene', 'res://src/scenes/test/test.tscn', '--quit'], {
  stdio: 'pipe',
});

let output = '';
let done = false;
const timeout = setTimeout(() => {
  done = true;
  console.log('\n=== TIMEOUT ===');
  console.log(output);
  process.exit(0);
}, 6000);

godot.stdout.pipeTo(
  new WritableStream({
    write(chunk) {
      output += chunk.toString();
    },
  }),
);

async function readStderr() {
  const reader = godot.stderr.getReader();
  while (!done) {
    const { done: doneReading, value } = await reader.read();
    if (doneReading) break;
    output += new TextDecoder().decode(value);
  }
}
readStderr();

await godot.exited;
clearTimeout(timeout);

console.log('\n=== OUTPUT ===');
console.log(output);

import { $ } from 'bun';

console.log('🎵 Synthesizing pipeline sound effects using FFmpeg...');

try {
  // 1. Pipeline Blocked: A harsh, double low-frequency alert (120Hz)
  await $`ffmpeg -y -f lavfi -i "sine=f=120:d=0.25" -f lavfi -i "sine=f=120:d=0.25" -f lavfi -i "anullsrc=d=0.05" -filter_complex "[0:a][2:a][1:a]concat=n=3:v=0:a=1[out]" -map "[out]" pipeline-blocked.wav`;
  console.log('✅ Generated pipeline-blocked.wav');

  // 2. Pipeline Complete: Ascending major triad chime (C5 -> E5 -> G5) with a clean fade-out
  await $`ffmpeg -y -f lavfi -i "sine=f=523.25:d=0.15" -f lavfi -i "sine=f=659.25:d=0.15" -f lavfi -i "sine=f=783.99:d=0.35" -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1,afade=t=out:st=0.5:d=0.15[out]" -map "[out]" pipeline-complete.wav`;
  console.log('✅ Generated pipeline-complete.wav');

  // 3. Pipeline Needs Input: A clear, two-tone "ding-dong" reminder (600Hz -> 450Hz)
  await $`ffmpeg -y -f lavfi -i "sine=f=600:d=0.2" -f lavfi -i "sine=f=450:d=0.4" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1,afade=t=out:st=0.45:d=0.15[out]" -map "[out]" pipeline-needs-input.wav`;
  console.log('✅ Generated pipeline-needs-input.wav');

  console.log('\n🚀 All audio assets generated successfully!');
} catch (_error) {
  console.error(
    '❌ Failed to generate sounds. Make sure FFmpeg is installed in your Nix environment.',
  );
  process.exit(1);
}

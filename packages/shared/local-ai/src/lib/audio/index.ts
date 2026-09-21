// packages/shared/local-ai/src/lib/audio/index.ts
//
// C-521: the portable audio-preparation core. Everything re-exported here is
// pure arithmetic over typed arrays — no Node/Bun/DOM imports, no ffmpeg
// execution. Hosts own the process spawn (see the local-stack finisher).
//
// Contract: C-521 Music and SFX generation with audio preparation

export * from './audio_analysis.ts';
export * from './audio_capability.ts';
export * from './audio_finishing.ts';
export * from './audio_rendition_profiles.ts';
export * from './loudness.ts';
export * from './wav_decode.ts';
export * from './waveform.ts';

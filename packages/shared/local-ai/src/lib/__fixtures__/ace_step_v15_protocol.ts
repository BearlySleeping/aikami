// packages/shared/local-ai/src/lib/__fixtures__/ace_step_v15_protocol.ts
// biome-ignore-all lint/style/useNamingConvention: ACE-Step v1.5 uses snake_case wire fields
//
// C-521 AC-1: the recorded ACE-Step 1.5 REST conversation.
//
// These are the *wire shapes* the v1.5 adapter parses, written down once so the
// adapter tests, the host runner and any future live smoke test agree on them.
// They are protocol fixtures, not live captures: the pinned upstream commit's
// server has not been run in this checkout (no GPU/model install), so the
// values below are the documented release_task/query_result envelope. The
// live-readiness preflight in the execution report names exactly what still
// needs a real server to confirm.
//
// Contract: C-521 Music and SFX generation with audio preparation

/** A `/release_task` acknowledgement as v1.5 returns it. */
export const ACE_STEP_V15_RELEASE_TASK_RESPONSE = {
  code: 200,
  data: { task_id: 'v15-task-7f3c1a' },
  message: 'Task submitted',
} as const;

/** A `/query_result` entry while the task is still queued. */
export const ACE_STEP_V15_QUERY_QUEUED = {
  code: 200,
  data: [{ task_id: 'v15-task-7f3c1a', status: 0, progress: 0 }],
} as const;

/** A `/query_result` entry while the task is running. */
export const ACE_STEP_V15_QUERY_RUNNING = {
  code: 200,
  data: [{ task_id: 'v15-task-7f3c1a', status: 1, progress: 0.5 }],
} as const;

/** A `/query_result` entry for a finished task, as a bare path string. */
export const ACE_STEP_V15_QUERY_SUCCEEDED_PATH = {
  code: 200,
  data: [
    {
      task_id: 'v15-task-7f3c1a',
      status: 2,
      progress: 1,
      result: '/models/audio/v15/output/v15-task-7f3c1a.wav',
    },
  ],
} as const;

/** A `/query_result` entry for a finished task, as a JSON blob string. */
export const ACE_STEP_V15_QUERY_SUCCEEDED_JSON = {
  code: 200,
  data: [
    {
      task_id: 'v15-task-7f3c1a',
      status: 2,
      progress: 1,
      result: '{"audio_path":"/models/audio/v15/output/v15-task-7f3c1a.flac","format":"flac"}',
    },
  ],
} as const;

/** A finished task whose reference points outside the artifact roots. */
export const ACE_STEP_V15_QUERY_SUCCEEDED_ESCAPING_PATH = {
  code: 200,
  data: [
    {
      task_id: 'v15-task-7f3c1a',
      status: 2,
      progress: 1,
      result: '/etc/passwd',
    },
  ],
} as const;

/** A task the server reports as failed. */
export const ACE_STEP_V15_QUERY_FAILED = {
  code: 200,
  data: [{ task_id: 'v15-task-7f3c1a', status: 3, message: 'CUDA out of memory' }],
} as const;

/** A task reporting a status value outside the recorded table. */
export const ACE_STEP_V15_QUERY_UNKNOWN_STATUS = {
  code: 200,
  data: [{ task_id: 'v15-task-7f3c1a', status: 42, progress: 0.2 }],
} as const;

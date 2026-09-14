// apps/backend/local-stack/stack/generation/index.ts
//
// Public entry point of the C-519 host runner (`@aikami/local-stack/generation`).
//
// The durable asset-batch host: the job/run/lease store, namespaced staging,
// the filesystem reference resolver and the batch orchestration. It consumes
// the portable schemas and the portable core from `@aikami/local-ai`, and it
// is imported by the image app's `generate:batch` CLI.
//
// C-521 adds the host-side audio finisher to the same entry point: it
// consumes the portable audio core instead of the plan core.
//
// Contract: C-519 Durable asset jobs and batch execution; C-521 audio preparation

export * from './audio_finishing.ts';
export * from './batch_reports.ts';
export * from './job_store.ts';
export * from './reference_resolver.ts';
export * from './runner.ts';
export * from './staging.ts';

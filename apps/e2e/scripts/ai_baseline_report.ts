// apps/e2e/scripts/ai_baseline_report.ts
//
// Issue #382: markdown rendering for the AI baseline harness.
//
// Split out of `ai_baseline_bench.ts` so the harness can grow scenarios without
// the measurement body and its presentation growing together. Every renderer
// here reads a plain `Record<string, unknown>` — the report format is a
// projection of the JSON, never a second source of truth.

/**
 * One line describing what the provider had loaded, and on what.
 *
 * Recorded because "which device served the tokens" is not decoration: a
 * contention figure from a GPU-backed local runtime and one from a CPU-only host
 * are different measurements, and the provider's own residency record is the
 * answer `lspci` gets wrong on this host.
 */
const describeResidency = (value: unknown): string => {
  const models = (
    (value as { models?: ReadonlyArray<Record<string, unknown>> } | undefined)?.models ?? []
  ).map((model) => {
    const vram = Number(model.size_vram ?? 0);
    const size = Number(model.size ?? 0);
    const device = vram > 0 && vram >= size ? 'fully in VRAM' : 'CPU / partial offload';
    return (
      `${String(model.name)} ctx ${String(model.context_length)} ` +
      `${(vram / 1e9).toFixed(1)}GB vram — ${device}`
    );
  });
  return models.length === 0 ? 'nothing resident (model evicted)' : models.join('; ');
};

/** The markdown header: hardware and model identity for one run. */
const renderHeader = (report: Record<string, unknown>): string[] => {
  const environment = report.environment as Record<string, unknown>;
  const gigabytes = (Number(environment.modelBytesOnDisk) || 0) / 1e9;
  const gpu = String(environment.gpu) || String(environment.gpuPci) || 'none detected';
  const gpuPci = String(environment.gpuPci ?? '');
  return [
    `# #382 AI baseline — \`${String(report.label)}\``,
    '',
    `**Commit:** \`${String(environment.gitSha)}\` (${String(environment.gitDescribe)})  `,
    `**Measured:** ${String(environment.measuredAt)}  `,
    `**Endpoint:** \`${String(environment.endpoint)}\`  `,
    `**Model:** \`${String(environment.model)}\` — ${String(environment.modelParameters)} `,
    `${String(environment.modelQuantization)}, ctx ${String(environment.modelContextLength)}, `,
    `${gigabytes.toFixed(1)}GB on disk  `,
    `**Hardware:** ${String(environment.cpuModel)} × ${String(environment.cpuCores)} cores, `,
    `${String(environment.totalMemoryGb)}GB RAM  `,
    `**GPU:** ${gpu}${gpuPci.length > 0 ? ` — pci reports no adapter; see pci field in JSON` : ''}  `,
    `**Provider residency at start:** ${describeResidency(environment.ollamaResidentModels)}  `,
    `**Repetitions:** ${String(environment.repetitions)} sequential, ` +
      `${String(environment.sweepSamples)} per context point, batch ${String(environment.batchSize)}`,
  ];
};

/**
 * Renders one scenario's wire summary.
 *
 * "0 cached tokens" and "cached tokens are not reported on this route" are
 * different claims and only one can be true. The native Ollama chat response
 * carries no cached-token field at all, so a `0` there would be a fabricated
 * measurement of something the provider never said.
 */
/** Formats a millisecond figure, keeping "not measured" visibly distinct. */
const ms = (value: unknown): string => (value === null ? 'not measured' : `${String(value)} ms`);

/**
 * Same, for a figure that is `undefined` when the provider did not report it.
 *
 * "unknown" is the honest rendering. Zero would assert that the phase took no
 * time, which is a claim about a counter the provider never sent.
 */
const known = (value: unknown): string =>
  value === undefined || value === null
    ? 'unknown (provider reported none)'
    : `${String(value)} ms`;

const renderWireTable = (summary: Record<string, unknown>): string[] => {
  const shapes = (summary.usageShapes as string[] | undefined) ?? [];
  const cacheCell = shapes.includes('openai')
    ? String(summary.totalCachedTokens)
    : 'unobservable — provider reported no cached-token field on this route';
  return [
    '| metric | value |',
    '|---|---|',
    `| provider HTTP requests | ${String(summary.providerRequests)} |`,
    `| median | ${ms(summary.medianMs)} |`,
    `| p95 | ${ms(summary.p95Ms)} |`,
    `| prompt tokens | ${String(summary.totalPromptTokens)} |`,
    `| completion tokens | ${String(summary.totalCompletionTokens)} |`,
    `| provider-cached prompt tokens | ${cacheCell} |`,
    `| responses with token counts | ${String(summary.rowsWithUsage)} |`,
    `| token accounting shape | ${shapes.join(', ') || 'none'} |`,
    `| failed requests | ${String(summary.failed)} |`,
    `| aborted requests (provider time wasted) | ${String(summary.aborted ?? 0)} |`,
    `| aborted request ms | ${known(summary.abortedMs ?? 0)} |`,
    `| provider model-load ms | ${known(summary.providerLoadMs)} |`,
    `| provider prefill ms | ${known(summary.providerPrefillMs)} |`,
    `| provider generation ms | ${known(summary.providerGenerationMs)} |`,
    `| provider total ms | ${known(summary.providerTotalMs)} |`,
    `| client total ms | ${known(summary.clientTotalMs)} |`,
    `| client overhead ms (queue + http + parse) | ${known(summary.clientOverheadMs)} |`,
  ];
};

/** Renders the client's own view of a scenario, when the seam reported one. */
const renderClientRows = (extra: Record<string, unknown> | undefined): string[] => {
  if (extra === undefined) {
    return [];
  }
  return Object.entries(extra).map(([key, value]) => `| client ${key} | ${String(value)} |`);
};

/** Renders the per-size breakdown of the context sweep, when present. */
const renderSizeRows = (bySize: Record<string, unknown>[] | undefined): string[] => {
  if (bySize === undefined) {
    return [];
  }
  return [
    '',
    '| prompt repeats | median | prompt tok/call | completion tok/call |',
    '|---|---|---|---|',
    ...bySize.map(
      (point) =>
        `| ${String(point.promptRepeats)} | ${ms(point.medianMs)} | ` +
        `${String(point.promptTokensPerCall)} | ${String(point.completionTokensPerCall)} |`,
    ),
  ];
};

/** Per-sample turn rows, for the production dialogue scenario. */
const renderTurnRows = (turns: Record<string, unknown>[] | undefined): string[] => {
  if (turns === undefined) {
    return [];
  }
  return [
    '',
    '| # | wall clock | ttft | source | schema valid | narrative non-empty | choices |',
    '|---|---|---|---|---|---|---|',
    ...turns.map(
      (turn, index) =>
        `| ${index + 1} | ${known(turn.wallClockMs)} | ${known(turn.ttftMs)} | ` +
        `${String(turn.source)} | ${String(turn.schemaValid)} | ` +
        `${String(turn.narrativeNonEmpty)} | ${String(turn.choiceCount)} |`,
    ),
  ];
};

/** Renders one `{ median, min, max, n }` aggregate cell as `median (min–max)`. */
const spreadCell = (value: unknown): string => {
  const record = value as
    | { median?: number | null; min?: number | null; max?: number | null }
    | undefined;
  if (record === undefined || record.median === null || record.median === undefined) {
    return 'not measured';
  }
  return `${String(record.median)} (${String(record.min)}–${String(record.max)})`;
};

/**
 * The width sweep, with the overlap proof next to every latency figure.
 *
 * A latency column without the background load that produced it is unreadable:
 * "width 4, TTFT 12 s" and "width 4 that silently fired one call" are different
 * measurements, and only the second one is what a bad harness produces.
 */
/**
 * Admission's own ledger for a width sweep.
 *
 * Extracted rather than inlined because the sweep renderer already carries
 * three tables, and a fourth branch ladder inside it pushed the function past
 * the complexity threshold — which is the guard correctly noticing that the
 * renderer was doing too much.
 *
 * A request WAITING for admission has sent nothing: no wire row, no telemetry
 * span yet. These columns are the only place such a request can be seen to
 * exist at all, and "absent from the wire" must never be read as "did not
 * happen".
 */
const renderAdmissionRows = (byWidth: readonly Record<string, unknown>[]): string[] => {
  const peak = (row: Record<string, unknown>, key: string): string =>
    String((row[key] as Record<string, number> | undefined)?.max ?? 0);
  const lines: string[] = [
    '',
    '| width | bg queued after burst | bg admitted before dialogue | bg in-flight at dialogue start | queue depth max | bg queue wait ms (min-max) | bg drain ms after turn (min-max) | bg dropped |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of byWidth) {
    lines.push(
      `| ${String(row.width)} | ${peak(row, 'backgroundQueuedAfterBurst')} | ` +
        `${peak(row, 'backgroundAdmittedBeforeDialogue')} | ` +
        `${peak(row, 'backgroundInFlightAtDialogueStart')} | ` +
        `${String(row.queueDepthMax ?? 0)} | ${spreadCell(row.queueWaitMs)} | ` +
        `${spreadCell(row.backgroundDrainMs)} | ${peak(row, 'backgroundDropped')} |`,
    );
  }
  return lines;
};

const renderWidthSweepRows = (scenario: Record<string, unknown>): string[] => {
  const byWidth = scenario.byWidth as Record<string, unknown>[] | undefined;
  if (byWidth === undefined) {
    return [];
  }
  const samples = (scenario.samples ?? []) as Record<string, unknown>[];
  const invalidReasons = (scenario.invalidReasons ?? []) as Record<string, unknown>[];
  const lines: string[] = [
    '',
    `**Measurement order** (${String(scenario.measurementOrderKind)}): \`${(
      (scenario.measurementOrder ?? []) as number[]
    ).join(',')}\``,
    '',
    `**Valid samples: ${String(scenario.validSamples)} of ${String(samples.length)}; ` +
      `invalid: ${String(scenario.invalidSamples ?? 0)}.** Aggregates below are built from ` +
      'valid samples only.',
    '',
    '| width | valid samples | actual bg calls (wire) | actual bg spans (client) | in-flight at dialogue start | TTFT median (min–max) | wall median (min–max) | bg latency median (min–max) | bg burst span median | turns FAILED outright | extraction accepted / degraded / unobservable | AI-authored vs fallback choices |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of byWidth) {
    const extraction = row.extraction as Record<string, number>;
    lines.push(
      `| ${String(row.width)} | ${String(row.validSamples)} | ${String(row.backgroundProviderRequests)} | ` +
        `${String(row.backgroundClientSpans)} | ${String(row.backgroundRequestsStillRunningAtDialogueStart)} | ` +
        `${spreadCell(row.ttft)} | ${spreadCell(row.wall)} | ${spreadCell(row.backgroundLatency)} | ` +
        `${spreadCell(row.backgroundBurstSpan)} | ${String(row.turnFailures ?? 0)} | ` +
        `${String(extraction.accepted)} / ${String(extraction.degraded)} / ${String(extraction.unobservable)} | ` +
        `${String(extraction.aiAuthoredChoices)} vs ${String(extraction.deterministicFallbackChoices)} |`,
    );
  }
  lines.push(...renderAdmissionRows(byWidth));
  lines.push(
    '',
    '| width | call-1 narrative total ms (min-max) | call-1 client-span total ms | call-2 extraction total ms (min–max) | call-2 client-span total ms | bg prefill ms | bg generation ms | bg prompt tok | bg completion tok | bg failed | bg aborted | commands extracted / denied |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const row of byWidth) {
    const extraction = row.extraction as Record<string, number>;
    lines.push(
      `| ${String(row.width)} | ${spreadCell(row.narrativeTotalMs)} | ${spreadCell(row.clientSpanNarrativeTotalMs)} | ` +
        `${spreadCell(row.extractionTotalMs)} | ${spreadCell(row.clientSpanExtractionTotalMs)} | ` +
        `${String(row.backgroundPrefillMs ?? 'unknown')} | ` +
        `${String(row.backgroundGenerationMs ?? 'unknown')} | ${String(row.backgroundPromptTokens)} | ` +
        `${String(row.backgroundCompletionTokens)} | ${String(row.backgroundFailures)} | ` +
        `${String(row.backgroundAborts)} | ${String(extraction.commandExtracted)} / ${String(extraction.commandDeniedByPreconditions)} |`,
    );
  }
  lines.push(
    '',
    '### Main-thread frame cadence during the dialogue turn',
    '',
    "`rAF` interval on the benchmark page, and the page's own `longtask` entries, sampled over exactly the turn window at every width. This is main-thread AVAILABILITY under provider CPU contention, not gameplay rendering: the benchmark page holds a static map with no input. The engine's own `frameDurationMs` counter is computed every frame and then discarded by `GameWorld.initialize`, so it is not readable from here.",
    '',
    '| width | frames observed (n) | frame interval median (min–max) ms | frame interval max ms | slow frames (>2× median) | longtasks | longtask total ms |',
    '|---|---|---|---|---|---|---|',
  );
  for (const row of byWidth) {
    lines.push(
      `| ${String(row.width)} | ${String((row.frameMedianMs as { n?: number }).n ?? 0)} | ` +
        `${spreadCell(row.frameMedianMs)} | ${spreadCell(row.frameMaxMs)} | ` +
        `${spreadCell(row.slowFrames)} | ${spreadCell(row.longTaskCount)} | ` +
        `${spreadCell(row.longTaskTotalMs)} |`,
    );
  }
  lines.push(
    '',
    '### Raw per-sample values',
    '',
    '`bg reqs` is provider requests attributed to the burst by a measured time boundary; `bg spans` is the client telemetry count of `summarization` calls. The two are independent signals of the same work. A turn of FAILED means `NpcDialogueService.generateTurn` rejected — the provider call was killed, so there is no TTFT and the call-2 columns are empty.',
    '',
    '| # | width | bg reqs | bg spans | in-flight at dialogue start | overlapped | turn | dialogue ttft ms | dialogue wall ms | narrative total ms | extraction total ms | extraction outcome | valid |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  samples.forEach((sample, index) => {
    const turn = (sample.turn ?? {}) as Record<string, unknown>;
    const dialogue = (sample.dialogue ?? {}) as Record<string, unknown>;
    const byCall = (dialogue.byCall ?? {}) as Record<string, Record<string, unknown>>;
    // "Unobservable" is a third state, not a synonym for either outcome: the
    // probe could not see the service's own log at all.
    let outcome = 'unobservable';
    if (turn.extractionDegraded === false) {
      outcome = 'accepted';
    } else if (turn.extractionDegraded === true) {
      outcome = 'degraded';
    }
    lines.push(
      `| ${index + 1} | ${String(sample.width)} | ${String(sample.backgroundProviderRequests ?? 0)} | ` +
        `${String(sample.backgroundClientSpans ?? 0)} | ` +
        `${String(sample.backgroundRequestsStillRunningAtDialogueStart ?? 0)} | ` +
        `${String(sample.overlapped ?? false)} | ${turn.turnFailed === true ? 'FAILED' : 'ok'} | ` +
        `${known(turn.ttftMs)} | ${known(turn.wallClockMs)} | ` +
        `${String(byCall.narrative?.medianMs ?? 'not measured')} | ` +
        `${String(byCall.extraction?.medianMs ?? 'no extraction call')} | ${outcome} | ` +
        `${String(sample.valid)} |`,
    );
  });
  if (invalidReasons.length > 0) {
    lines.push(
      '',
      '### Invalid samples',
      '',
      ...invalidReasons.map(
        (entry) =>
          `- sample ${String(Number(entry.orderIndex) + 1)} (width ${String(entry.width)}): ${String(entry.reason)}`,
      ),
    );
  }
  return lines;
};

/**
 * Renders the already-running-background experiment.
 *
 * A deliberately forced ordering, reported on its own and never merged with the
 * width sweep: these samples are the ones admission CANNOT protect, so they are
 * the honest boundary of the mechanism rather than evidence for it.
 */
const renderResidualRows = (scenario: Record<string, unknown>): string[] => {
  const samples = (scenario.samples ?? []) as Record<string, unknown>[];
  const ttft = scenario.ttftMs as Record<string, number> | undefined;
  return [
    '',
    `**${String(scenario.samplesWithBackgroundOnProvider ?? 0)} of ` +
      `${String(scenario.samplesMeasured ?? 0)} samples had the background request proven ` +
      'provider-in-flight before dialogue started;** provider overlap was observed in ' +
      `${String(scenario.providerOverlapObserved ?? 0)}.`,
    '',
    `TTFT median (min–max): **${spreadCell(ttft)}**. Turns failed outright: ` +
      `${String(scenario.turnFailures ?? 0)}.`,
    '',
    '| sample | bg reached provider | bg in-flight at dialogue start | bg wire requests | overlapped dialogue | TTFT (ms) | turn wall (ms) |',
    '|---|---|---|---|---|---|---|',
    ...samples.map(
      (sample) =>
        `| ${String(sample.index)} | ${String(sample.backgroundReachedProvider)} | ` +
        `${String(sample.backgroundInFlightAtDialogueStart)} | ` +
        `${String(sample.backgroundProviderRequests)} | ${String(sample.overlapped)} | ` +
        `${ms(sample.ttftMs)} | ${ms(sample.wallClockMs)} |`,
    ),
  ];
};

export const renderMarkdown = (report: Record<string, unknown>): string => {
  const scenarios = report.scenarios as Record<string, Record<string, unknown>>;
  const lines: string[] = [...renderHeader(report), '', '## Scenarios', ''];

  for (const [id, scenario] of Object.entries(scenarios)) {
    lines.push(`### ${id}`, '', `${String(scenario.description)}`, '');

    // The residual experiment is its own shape: no aggregated wire summary,
    // because its whole point is a per-sample comparison of one background
    // request against one turn.
    if (scenario.samples !== undefined && scenario.byWidth === undefined) {
      lines.push(...renderResidualRows(scenario), '');
      continue;
    }

    // The width-sweep scenario aggregates per-width, so a single flat table
    // would be meaningless for it.
    if (scenario.byWidth === undefined) {
      const wire = scenario.wire as Record<string, unknown> | undefined;
      if (wire !== undefined) {
        lines.push(...renderWireTable(wire));
      }
      lines.push(
        ...renderClientRows(scenario.client as Record<string, unknown> | undefined),
        ...renderSizeRows(scenario.bySize as Record<string, unknown>[] | undefined),
        ...renderTurnRows(scenario.turns as Record<string, unknown>[] | undefined),
        '',
      );
      continue;
    }
    lines.push(...renderWidthSweepRows(scenario), '');
  }

  return `${lines.join('\n')}\n`;
};

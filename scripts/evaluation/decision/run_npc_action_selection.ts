// scripts/evaluation/decision/run_npc_action_selection.ts
//
// Runs the lane C comparison (issue #381).
//
//   bun scripts/evaluation/decision/run_npc_action_selection.ts \
//     --endpoint http://127.0.0.1:11435 \
//     --model tev1 \
//     --out .evidence/381/npc-action-selection-tev1.json
//
// Four arms, ONE corpus, ONE scorer, ONE set of conditions:
//
//   deterministic  the in-process lexicon control
//   chat-llm       the path production uses today, through the same pipeline
//   systemone:<m>  each available decision checkpoint
//
// Exit codes: 0 measured, 1 gate failed, 2 backend unavailable. "Unavailable"
// is never reported as a pass.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDeterministicDecisionAdapter,
  createSystemOneDecisionAdapter,
} from '../../../packages/frontend/ai-gateway/src/lib/decision/index.ts';
import { createChatModelDecisionAdapter } from '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/chat_model_baseline_adapter.ts';
import {
  NPC_ACTION_SELECTION_DEV,
  NPC_ACTION_SELECTION_HELDOUT,
  type NpcActionFixtureCase,
} from '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_corpus.ts';
import {
  NPC_ACTION_SELECTION_LATENCY_GATE,
  NPC_ACTION_SELECTION_QUALITY_GATE,
  NPC_ACTION_SELECTION_TASK_ID,
  NPC_ACTION_SELECTION_TASK_VERSION,
  npcActionSelectionPolicy,
} from '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_selection.ts';
import {
  formatSlice,
  measureNpcActionSelection,
  type NpcActionCorpusCase,
  type NpcActionMeasurement,
} from '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_selection_measurement.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const parseArgs = (argv: readonly string[]): Record<string, string> => {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token?.startsWith('--') === true) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[token.slice(2)] = next;
        index += 1;
      } else {
        args[token.slice(2)] = 'true';
      }
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));
const endpoint = args.endpoint ?? 'http://127.0.0.1:11435';
const models = (args.model ?? 'tev1').split(',').map((model) => model.trim());
const chatBaseUrl = args['chat-base'] ?? 'http://127.0.0.1:11434/v1';
const chatModel = args['chat-model'] ?? 'qwen3:14b';
const outPath = args.out ?? resolve(HERE, '../../../.evidence/381/npc-action-selection.json');
/** Comma-separated arm filter, so a slow arm can be re-run on its own. */
const onlyArms = args.arms ? new Set(args.arms.split(',').map((a) => a.trim())) : undefined;

const toCorpusCase = (entry: NpcActionFixtureCase): NpcActionCorpusCase => ({
  caseId: entry.caseId,
  category: entry.category,
  language: entry.language,
  kind: entry.kind,
  expected: entry.expected,
  state: entry.state,
  npcId: entry.npcId,
  options: entry.options,
  rationale: entry.rationale,
});

/**
 * The corpus, read from the typed fixture exports rather than the raw JSON
 * imports, so each case shape is checked by the loader that already validates
 * it rather than asserted here.
 */
const splits = {
  dev: NPC_ACTION_SELECTION_DEV.cases.map(toCorpusCase),
  heldout: NPC_ACTION_SELECTION_HELDOUT.cases.map(toCorpusCase),
};

console.log(
  `corpus: dev=${splits.dev.length} heldout=${splits.heldout.length} task=${NPC_ACTION_SELECTION_TASK_ID}@v${NPC_ACTION_SELECTION_TASK_VERSION}`,
);
console.log(
  `gates (frozen): minPositiveRecall=${NPC_ACTION_SELECTION_QUALITY_GATE.minPositiveRecall} maxFalseAcceptances=${NPC_ACTION_SELECTION_QUALITY_GATE.maxFalseAcceptances} maxFalseAcceptanceRate=${NPC_ACTION_SELECTION_QUALITY_GATE.maxFalseAcceptanceRate} minCoverage=${NPC_ACTION_SELECTION_QUALITY_GATE.minCoverage}`,
);
console.log(
  `latency (frozen): warmP50<=${NPC_ACTION_SELECTION_LATENCY_GATE.maxWarmP50Ms} warmP95<=${NPC_ACTION_SELECTION_LATENCY_GATE.maxWarmP95Ms} coldP95<=${NPC_ACTION_SELECTION_LATENCY_GATE.maxColdP95Ms}`,
);
console.log('');

/**
 * The deterministic control.
 *
 * A keyword lexicon over the exchange. Deliberately crude: it exists to show
 * what a no-inference baseline scores on the same corpus, so a decision
 * checkpoint's recall can be read against "a lexicon" rather than against zero.
 */
/**
 * The deterministic control.
 *
 * A hand-written per-NPC keyword lexicon — the control a reviewer would actually
 * write, and the only no-inference baseline that can be scored on this corpus.
 *
 * Two things make it work, and both are worth stating because their absence
 * looks like "the lexicon scored zero" rather than "the lexicon was broken":
 *
 *   - Every rule carries an explicit `weight`. The adapter scores
 *     `hits * weight`; an omitted weight is `NaN`, the whole distribution goes
 *     non-finite, and the selective-acceptance policy then rejects EVERY answer
 *     as below threshold. The baseline abstains 100% and looks cautious.
 *   - Every pattern carries the NPC's DISPLAY name, which is not its id.
 *     `village_elder` is "Elder Thalia"; a rule written against the id matches
 *     nothing except the id, which no exchange contains.
 *
 * A global lexicon with no NPC scoping cannot score on this corpus at all: the
 * same exchange text resolves to different actions for different NPCs, and a
 * label naming an option that NPC was never offered cannot be reconstructed.
 */
const deterministic = createDeterministicDecisionAdapter({
  backendId: 'deterministic-lexicon',
  rules: {
    rules: {
      actionId: [
        // Elder Thalia — offers exactly one quest and two evidence items.
        {
          weight: 1,
          match: [
            'elder thalia',
            'what needs doing',
            'looking for work',
            'my brother went out',
            'lamps keep going out',
            'anyone else able to help with the wards',
            'looking for hands',
          ],
          value: 'offerQuest:fading_ward',
        },
        {
          weight: 1,
          match: [
            'elder thalia',
            'this was on the shop counter',
            'sella gave me',
            'merchant’s repair ledger',
            "merchant's repair ledger",
          ],
          value: 'presentEvidence:the_ledger',
        },
        { weight: 1, match: ['elder thalia', 'receipt'], value: 'presentEvidence:sella_receipt' },
        // Orra the smith — offers exactly one quest.
        {
          weight: 1,
          match: ['orra', 'my blade', 'you have work'],
          value: 'offerQuest:tools_for_tomorrow',
        },
        // Sella the innkeeper — offers exactly one quest.
        {
          weight: 1,
          match: [
            'sella',
            'anywhere for a traveller',
            'half the village is sleeping rough',
            'word is right',
          ],
          value: 'offerQuest:a_room_kept_warm',
        },
        // Ada the woodcutter — offers exactly one quest.
        { weight: 1, match: ['ada', 'path east is gone'], value: 'offerQuest:mark_the_safe_trail' },
        // Mara the merchant — a vendor holding six items.
        {
          weight: 1,
          match: [
            'mara the merchant',
            'what do you have for sale',
            'prices are robbery',
            'show me your wares',
            'your wares',
          ],
          value: 'trade',
        },
        {
          weight: 1,
          match: [
            'mara the merchant',
            'did not expect to come back',
            'my arm is not right',
            'potion problem',
          ],
          value: 'giveItem:healthPotion',
        },
        {
          weight: 1,
          match: ['mara the merchant', 'something to cut with', 'right counter'],
          value: 'giveItem:steelSword',
        },
        {
          weight: 1,
          match: ['mara the merchant', 'burned through everything'],
          value: 'giveItem:manaPotion',
        },
        // Bram the guard — recruitable and combat-capable.
        {
          weight: 1,
          match: ['bram the guard', 'cannot hold the road alone', 'better off with us'],
          value: 'recruit',
        },
        {
          weight: 1,
          match: ['bram the guard', 'step aside', 'last chance', 'draw your blade'],
          value: 'startCombat',
        },
        // Ash Hound and the Ember Warden — combat only.
        { weight: 1, match: ['ash hound'], value: 'startCombat' },
        { weight: 1, match: ['ember warden', 'not stopping'], value: 'startCombat' },
        // Nemi the shrine keeper — one evidence item.
        {
          weight: 1,
          match: ['nemi', 'old road gives out', 'i found this'],
          value: 'presentEvidence:tess_component',
        },
        // Rollo the Grasper — one evidence item.
        {
          weight: 1,
          match: ['rollo the grasper', 'went into the well'],
          value: 'presentEvidence:elders_seal',
        },
      ],
    },
  },
});

const adapters: {
  label: string;
  adapter:
    | ReturnType<typeof createSystemOneDecisionAdapter>
    | ReturnType<typeof createDeterministicDecisionAdapter>
    | ReturnType<typeof createChatModelDecisionAdapter>;
}[] = [
  { label: 'deterministic', adapter: deterministic },
  {
    label: `chat-llm:${chatModel}`,
    adapter: createChatModelDecisionAdapter({ baseUrl: chatBaseUrl, model: chatModel }),
  },
  ...models.map((model) => ({
    label: `systemone:${model}`,
    adapter: createSystemOneDecisionAdapter({
      runtime: 'ollama' as const,
      endpoints: {
        decision: `${endpoint.replace(/\/+$/, '')}/v1/systemone`,
        version: `${endpoint.replace(/\/+$/, '')}/api/version`,
        models: `${endpoint.replace(/\/+$/, '')}/v1/models`,
      },
      model,
      languages: ['en'],
    }),
  })),
];

const results: { arm: string; measurement: NpcActionMeasurement }[] = [];

if (args.calibrate !== undefined) {
  // CALIBRATION PASS — development split only, no selective-acceptance policy.
  //
  // The point is to see what each backend WOULD answer before a threshold
  // exists, so the threshold can be chosen from observed confidence rather than
  // declared blind. Held-out data is never read here.
  // The only difference: no `choicePolicy`. With none, every schema-valid
  // answer is accepted as-is, so this pass observes what the backend WOULD say
  // rather than what survives a threshold nobody has justified yet.
  const unthresholded = (
    optionIds: readonly string[],
    descriptions: Readonly<Record<string, string>>,
  ) => {
    const { choicePolicy: _dropped, ...rest } = npcActionSelectionPolicy(optionIds, descriptions);
    return rest;
  };
  const calibration = await measureNpcActionSelection({
    adapter:
      adapters.find((entry) => entry.label === (args.arms ?? `systemone:${models[0]}`))?.adapter ??
      adapters[adapters.length - 1].adapter,
    cases: splits.dev,
    splits: { dev: splits.dev },
    qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    policyOverride: unthresholded,
  });
  const dev = calibration.splits[0];
  console.log('calibration (development split, no thresholds):');
  console.log(
    'caseId                          kind              expected                       produced                        correct  p(chosen)',
  );
  for (const entry of dev?.cases ?? []) {
    const expected = splits.dev.find((c) => c.caseId === entry.caseId)?.expected ?? 'null';
    console.log(
      [
        entry.caseId.padEnd(30),
        entry.kind.padEnd(17),
        String(expected).padEnd(30),
        String(entry.producedOption ?? '-').padEnd(31),
        String(entry.correct).padEnd(8),
        entry.chosenProbability === undefined ? 'n/a' : entry.chosenProbability.toFixed(4),
      ].join(' '),
    );
  }
  process.exit(0);
}

for (const entry of adapters) {
  if (onlyArms !== undefined && !onlyArms.has(entry.label)) {
    continue;
  }
  process.stdout.write(`── ${entry.label} … `);
  const started = Date.now();
  let measurement: NpcActionMeasurement;
  try {
    measurement = await measureNpcActionSelection({
      adapter: entry.adapter,
      cases: [...splits.dev, ...splits.heldout],
      splits,
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
      latencyGate: NPC_ACTION_SELECTION_LATENCY_GATE,
    });
  } catch (error) {
    // One arm failing must not take the comparison with it. An arm that threw
    // is an arm that was NOT measured, and is reported as exactly that.
    console.log(`ERROR — ${String(error)}`);
    results.push({
      arm: entry.label,
      measurement: {
        backendId: entry.adapter.backendId,
        dialect: entry.adapter.dialect,
        task: NPC_ACTION_SELECTION_TASK_ID,
        status: 'unavailable',
        unavailableReason: `arm threw: ${String(error)}`,
        conditions: {
          coldSamples: 3,
          warmupRequests: 3,
          minimumPercentileSamples: 20,
          perCaseTimeoutMs: 120_000,
        },
        latencyConditionMethod: 'cold-then-warm',
        splits: [],
        gateFailures: [],
        percentileEstablished: false,
      },
    });
    continue;
  }
  results.push({ arm: entry.label, measurement });

  if (measurement.status === 'unavailable') {
    console.log(`UNAVAILABLE (${measurement.unavailableReason})`);
    continue;
  }
  console.log(`measured in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const split of measurement.splits) {
    console.log(`   ${split.split.padEnd(8)} ${formatSlice(split.overall)}`);
    for (const slice of split.byCategory) {
      console.log(`     · ${slice.key.padEnd(12)} ${formatSlice(slice)}`);
    }
  }
  console.log(
    `   gate: ${measurement.gateFailures.length === 0 ? 'PASS' : `FAIL — ${measurement.gateFailures.join('; ')}`}`,
  );
}

/**
 * The exact command that produced this artifact.
 *
 * Embedded so a reviewer can re-run it verbatim rather than reconstructing it
 * from the report — and so a number can always be traced to the invocation that
 * made it.
 */
const command = [
  'bun scripts/evaluation/decision/run_npc_action_selection.ts',
  `--endpoint ${endpoint}`,
  `--model ${models.join(',')}`,
  `--chat-model ${chatModel}`,
  onlyArms === undefined ? '' : `--arms ${[...onlyArms].join(',')}`,
  `--out ${outPath}`,
]
  .filter((part) => part.length > 0)
  .join(' ');

/** Content hash of a corpus file, so a report can name the exact input. */
const hashOf = (file: string): string =>
  createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex').slice(0, 16);

const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      runId,
      task: NPC_ACTION_SELECTION_TASK_ID,
      taskVersion: NPC_ACTION_SELECTION_TASK_VERSION,
      recordedAt: new Date().toISOString(),
      command,
      runtime: {
        // The runtime/model identity that produced these numbers, and the
        // isolation it ran under. The pinned daemon returns 404 on
        // /v1/systemone, so the decision arms need an isolated 0.35+.
        decisionEndpoint: endpoint,
        decisionRuntime: 'ollama >= 0.35.0 (isolated daemon, separate model dir)',
        sharedDaemonUnmodified: 'http://127.0.0.1:11434 (ollama 0.34.4) — untouched',
        checkpoints: models,
        chatComparator: { endpoint: chatBaseUrl, model: chatModel },
      },
      corpusHashes: {
        dev: hashOf(
          resolve(
            HERE,
            '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/fixtures/npc_action_selection_dev.json',
          ),
        ),
        heldout: hashOf(
          resolve(
            HERE,
            '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/fixtures/npc_action_selection_heldout.json',
          ),
        ),
      },
      endpoint,
      chatBaseUrl,
      chatModel,
      conditions: { coldSamples: 3, warmupRequests: 3, minimumPercentileSamples: 20 },
      gates: {
        quality: NPC_ACTION_SELECTION_QUALITY_GATE,
        latency: NPC_ACTION_SELECTION_LATENCY_GATE,
      },
      corpus: {
        dev: splits.dev.length,
        heldout: splits.heldout.length,
        provenance: NPC_ACTION_SELECTION_HELDOUT.labelProvenance,
      },
      aggregation:
        'per split: overall + per-category slices; gates from the heldout split only; every fixture case scored exactly once (denominatorProblems must be empty)',
      arms: results,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`\nartifact -> ${outPath}`);

const anyUnavailable = results.some((entry) => entry.measurement.status === 'unavailable');
// Only the CHECKPOINTS under test decide the exit code. The deterministic
// control is a baseline, not a candidate: letting a control's failure set the
// status would report the decision backends as unmeasured-and-failed.
const decisionArms = results.filter((entry) => entry.arm.startsWith('systemone:'));
const anyMeasured = decisionArms.some((entry) => entry.measurement.status === 'measured');
if (!anyMeasured) {
  console.log('\nNO-GO: no decision checkpoint could be measured.');
  process.exit(2);
}
const anyFailed = decisionArms.some(
  (entry) => entry.measurement.status === 'measured' && entry.measurement.gateFailures.length > 0,
);
if (anyUnavailable || anyFailed) {
  process.exit(1);
}
process.exit(0);

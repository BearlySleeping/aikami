# Tauri Desktop Boot Failure — Handoff

**Status: ASSET-PIPELINE HANG CLOSED. NEW ISSUE OPEN: BLANK CANVAS AFTER A
SUCCESSFUL BOOT.** The Tauri desktop build originally would not boot at all —
`assetManager.initialize()` blew the 20s boot budget. That is now fixed and
verified (2026-08-27): `/dev/tauri-test`'s "Asset pipeline" probe went from
16.6s to **1,422ms**, and a real `/dev/sandbox` run completed the full boot
sequence end to end (`boot:complete`, entities spawned, tick loop running,
no timeout). Four rounds of fixes got there:

1. Removed a redundant full-catalog re-read pass — reduced work, did not
   clear the timeout (`initialize()` still completed, just >20s late).
2. Raised eager-fetch concurrency from 1 → 24 — got the real 12,726-row
   catalog to 16.6s (under the 20s budget, but only ~17% margin).
3. Raised concurrency 24 → 64 to buy more margin — **made no measurable
   difference** (16.6s either way). Proved the ceiling wasn't JS-side
   parallelism but total IPC round-trip count — WebKitGTK's IPC bridge has a
   throughput floor concurrency can't get under.
4. Stopped eagerly fetching all 12,726 cached assets at every boot — only the
   ~16 offline-core tags actually need synchronous readiness; everything
   else now resolves lazily on first real use (`coreTags` param on
   `initialize()`). Cut eager IPC calls ~800x. **This is what actually
   closed it** — verified against real hardware, see §7.

**New issue, opened this session, not yet root-caused:** with boot now
completing quickly and cleanly, `/dev/sandbox` shows an **empty canvas** —
no visible rendering — despite the engine reporting a fully successful boot
(entities created, tick loop alive, no errors). This is almost certainly
unrelated to the asset pipeline work above; see §9.

**New: `/dev/tauri-test` now has an "Asset pipeline (real, boot-equivalent)"
probe group** that runs the actual `assetPrefetchService.ensureRegistryReady()`
call (same singleton, same steps, same budgets `GameBootService` uses) and
reports total wall time plus row counts — this is the fastest way to validate
a change to this path without a full `/game` boot. Launch straight into it
(`--route /dev/tauri-test`) rather than visiting `/game` first in the same
session, or the pipeline promise will already be memoized and the probe will
just report the cached result.

Environment: NixOS, webkitgtk `2.52.6+abi=4.1`, Tauri v2 / wry, hybrid Intel
i915 GPU, bun 1.3.13. Last verified 2026-08-27.

See also `docs/guides/TAURI.md` for this repo's other WebKitGTK-on-Linux notes.

---

## 1. Current failure

```
[GameBootService] stage:initializing_asset_registry:degraded
  asset registry step "assetManager.initialize" did not settle within 20000ms
[GameBootService] boot:stage-failed
  stage: "prefetching_starter_content"
```

`assetManager.initialize()` **hangs** — it does not throw. The boot stage
catches every exception and degrades, so a timeout there proves the promise
never settled.

**Root cause confirmed (2026-08-27): redundant full-catalog re-read, not a
stuck IPC call.** The `/dev/tauri-test` "Cache backend" probe group is fully
green in isolation — `init()` 29ms, `listHashes()` 31ms for **11,556 cached
entries**, `get()`/`put()`/`remove()` each ~2ms. So `TauriFSCacheBackend`
itself is fast; the bug is call volume, not IPC latency.

`initialize()` runs two sequential loops over the same catalog:

1. Rehydrates every row from `registry.listInstallStates()` marked `cached`,
   calling `backend.get()` once per row and registering a blob URL.
2. Rehydrates every hash returned by `backend.listHashes()` — again calling
   `backend.get()` once per hash — as a fallback path for when install-state
   bookkeeping was lost.

Loop 2 called `backend.get(record.hash)` **unconditionally for every
record**, including ones loop 1 had just fetched and registered moments
earlier. With bookkeeping intact (the normal case), loop 2 duplicates loop
1's work exactly — a full second pass reading all 11,556 blobs over IPC, one
at a time, no batching. That's what blows the outer 20s budget in
`asset_prefetch_service.svelte.ts`; no single call is slow, but ~23k
sequential round trips easily are.

**Fixed** in `asset_manager.svelte.ts`: loop 2 now skips the `backend.get()`
call when `this._verifiedHashes.get(record.id) === record.hash` — i.e. loop 1
already verified and fetched this exact blob — so the fallback path only
does work for entries install-state bookkeeping actually lost track of.

**Also fixed, secondary hardening:** `registry.setInstallState(...)` inside
loop 2 was the one call in `initialize()` not wrapped in `withStepTimeout`
(everything else was). Now wrapped (name `registry.setInstallState(byHash)`,
8s budget matching its siblings) so a stall there names itself instead of
surfacing as the generic outer `"assetManager.initialize"` timeout.

**Round 2 (still 2026-08-27): removing the redundant pass was not enough.**
Retesting after the loop-2 skip above still hit
`asset registry step "assetManager.initialize" did not settle within 20000ms`
at boot — but a `[AssetManager] asset_manager:initialized` debug log appeared
~20s *after* the failure was reported. The promise was not hung; it was
correctly slow. Loop 1 alone still issues one `backend.get()` IPC round trip
**per cached asset, fully sequential**, for however many rows
`listInstallStates()` returns as `'cached'` — with the catalog this large,
sequential per-item Tauri IPC calls add up past 20s even though each
individual call is fast (the `/dev/tauri-test` probe's `get()` timing used a
synthetic 4-byte file, not real sprite/audio-sized blobs, so it understated
real per-call cost).

The class already has a *lazy* path for this — `_doResolve()` step 1b
materialises a blob URL from `_verifiedHashes` on first real access — but
`initialize()` deliberately does it *eagerly* instead, per its own comment:
the engine's synchronous `acquireUrl()`/`peekBlobUrl()` fast path needs the
blob URL ready before first use, so purely lazy resolution would silently
degrade cached assets to the network/static fallback on first frame. Eager
fetching can't be removed; it has to be made concurrent instead.

**Fixed:** both rehydration loops now run through a new
`AssetManager._forEachConcurrent()` helper with `_rehydrateConcurrency`
in-flight `backend.get()` calls at a time, instead of one at a time. This
keeps eager, synchronous-ready materialisation but bounds wall time to
roughly `catalogSize / concurrency` round trips instead of `catalogSize`.

**Round 3 measurement (2026-08-27, real hardware, real 12,726-row catalog):**
the new `/dev/tauri-test` "Asset pipeline" probe (see below) put
`_rehydrateConcurrency = 24` at **16.6s total** for `ensureRegistryReady()`.
Raised to 64 and re-measured: **16.7s — no measurable change.** That
disproved "not enough parallelism" as the remaining problem: the IPC channel
has a fixed throughput floor per call that JS-side concurrency cannot get
under, so the only lever left is reducing how many calls happen at all.

**Round 4 fix (2026-08-27) — stop conflating "cached" with "must be
synchronous-ready".** `initialize()` was eagerly fetching **every** cached
asset (12,726 of them) at **every boot**, because the engine's synchronous
`acquireUrl()`/`peekBlobUrl()` fast path needs a materialised blob URL before
first use. But the debug log already showed the real number that actually
needs that guarantee: `assetStore: catalog loaded – {count: 12732,
coreTags: 16, ...}` — only 16 tags are the offline-core set that must render
with zero flicker on first frame. The other ~12,700 are downloaded catalog
content with no such requirement, and the class already has a lazy
materialisation path built for exactly this (`_doResolve` step 1b) that just
wasn't being used for them.

`initialize()` now takes an optional `coreTags: ReadonlySet<string>` (passed
by `asset_prefetch_service.svelte.ts` as `assetStore.coreTags`). Only tags in
that set are eagerly fetched + blob-URL-registered during rehydration;
every other cached tag gets its verified hash recorded (cheap, no IPC) and
materialises lazily the first time something actually resolves it. This cuts
eager rehydration from ~12,726 IPC round trips to ~16, independent of
concurrency tuning. **Trade-off, deliberately accepted:** the first time a
non-core asset is used each session, there's one lazy async fetch before its
blob URL exists — a possible one-time pop/flicker for that asset, where
previously it was always pre-warmed. Omitting `coreTags` (as the existing
unit tests do) preserves the old eager-everything behaviour.

Concurrency stays at 64 (harmless, just no longer the limiting factor for the
~16-tag core path either).

The `isTauri ? TauriFSCacheBackend : OpfsCacheBackend` split
(`asset_manager.svelte.ts:693`) is **not** the root cause on its own — the
probe shows the Tauri backend is fast per-call. The bug was in how
`initialize()` used it (2x redundant full-catalog reads, then fully
sequential even after dedup), not the backend itself.

**Related, separate finding: `OpfsCacheBackend.get()` (Web only) re-hashes
every read.** `opfs_cache_backend.ts` computes `sha256Hex(blob)` on every
single `get()` call to verify the file wasn't corrupted/tampered — CPU work,
not I/O, so it's not IPC-bound and unaffected by `_rehydrateConcurrency`.
This is why `aikami.bearlysleeping.com` logs spam `backend.get(cachedState)`
`step:complete` lines every page load even with the core already downloaded
— every reload re-verifies every cached blob's hash before reusing it.
`TauriFSCacheBackend.get()` does **not** do this (desktop trusts the local
filesystem). The round-4 `coreTags` fix above shrinks this cost on Web too
(from ~12,700 re-hashes per load down to ~16), but the re-hash-on-every-read
behavior itself is unchanged and still applies to whatever set is eager. Not
fixed here — flagging in case ~16 re-hashes/load is still worth removing
later (e.g. trust the OS/browser-verified write from `put()` and drop
read-time verification, or only re-verify probabilistically).

---

## 2. The one unfixable platform fact

Every DOM viewport API in this webview returns garbage derived from one bad
value. The numbers are exact, not random:

| Metric | Value |
| --- | --- |
| `window.devicePixelRatio` | `-0.010416666977107525` (exactly `-1/96`) |
| `window.innerWidth` | `-134880` |
| `window.innerHeight` | `-129120` |
| `documentElement.clientWidth` | `1405000003` |
| **Tauri `innerSize()`** | **1445 × 1432 (correct)** |
| **Tauri `scaleFactor()`** | **1 (correct)** |

`-134880 / 96 = -1405`, and `clientWidth` reports `1405000003`. One bad number,
everything else derived from it.

Tauri's native `scaleFactor()` is correct, so **GDK and wry are healthy and the
corruption is inside WebKit's own DOM metric computation.** `GDK_SCALE` cannot
fix it.

> **Standing rule:** never read `window.innerWidth`, `innerHeight`,
> `devicePixelRatio`, or `clientWidth/Height` in this webview. Source every
> dimension from `getCurrentWindow().innerSize()`. There is no fix, only
> avoidance.

Why it matters: `canvas.width` is IDL `unsigned long`, so a negative assignment
wraps mod 2^32 into a multi-gigapixel request that WebKit refuses *silently*,
leaving the canvas at its 300×150 default — a black screen with nothing thrown.

---

## 3. Ruled out — do not re-investigate

| Hypothesis | Evidence against |
| --- | --- |
| R2 CORS blocks `tauri://localhost` | Policy is `{"origins":["*"],"methods":["GET","HEAD"],"headers":["*"]}` (`bun cf r2 buckets cors get aikami-catalog`); `curl` with `Origin: tauri://localhost` returns `access-control-allow-origin: *`; all sampled offline-core binaries return 200; in-app probe fetched the seed at `200 OK in 15ms` |
| GPU / driver instability | `--software-gl` gave a byte-identical report; `webgl2` available, `MAX_TEXTURE_SIZE` 32768 |
| Negative GDK scale factor | Tauri `scaleFactor()` returns `1` |
| Missing COOP/COEP in Tauri | The working deployment's `static/_headers` sets no COEP either, so it also lacks `SharedArrayBuffer` and also falls off OPFS. These headers are **not a blank-canvas fix** and must not be added as one. OPFS persistence remains a separate rollout task that requires validating every cross-origin network path; see [`docs/TODO.md`](../TODO.md). |
| Service worker stale bundle | `src/service-worker.js` returns early unless the path starts with `/game-data/{music,sfx,ambient}/` |
| Missing `SharedArrayBuffer` breaks the engine | The SAB path was already removed; the engine uses an N-buffer `postMessage` protocol |
| `requestAnimationFrame` never fires | 34 frames / 500ms |
| Worker messaging / transfer blocked | Echo round-trip 3ms; `ArrayBuffer` transfer detaches |
| `Canvas area exceeds the maximum limit` is the game canvas | It is `luna-dom-highlighter` inside **eruda** (`PUBLIC_ERUDA_ENABLED=1`), sizing an overlay canvas from the corrupt `innerWidth` |

---

## 4. Bugs found and fixed

Each hid the next; fixing them is what let boot advance far enough to expose
the current failure.

| Bug | Mechanism | File |
| --- | --- | --- |
| Canvas allocation refused | Negative dimension wraps mod 2^32; WebKit refuses silently | `packages/frontend/engine/src/pixi_init_options.ts` |
| N-buffer rotation deadlock | Scan wrapped to `oldIndex` itself, nulled that slot, then built a view on the `null`. `new Float32Array(null)` is zero-length but **truthy**, defeating the recycle gate. Froze at exactly `FALLBACK_BUFFER_COUNT` ticks | `packages/frontend/engine/src/worker/ecs_worker.ts` |
| Catalog fetch could hang forever | Bare `fetch()`, no timeout; memoized `_loadPromise` stayed pending for the process lifetime | `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` |
| Poisoned memoization | `_registryReadyPromise` memoized with `??=`, never cleared on failure | `.../assets/asset_prefetch_service.svelte.ts` |
| WebGL context loss unhandled | Engine had no listener. Spec requires `event.preventDefault()` in `webglcontextlost` or restoration is never attempted | `packages/frontend/engine/src/pixi_app.ts` |
| SW registration threw | `tauri://localhost` is not http/https (SvelteKit 3 migration regression) | `apps/frontend/client/src/app.html` |
| CSP blocked IPC + data URIs | `connect-src` lacked `ipc: http://ipc.localhost` and `data:` | `apps/frontend/client/src-tauri/tauri.conf.json` |
| Log shipping spam | Doomed cross-origin POST per log line | `packages/shared/logger/src/lib/logger_browser.ts` |
| Router warning flood | Sync guard keys on `pathname + search`; preview pages write state to the query string | `packages/frontend/services/src/lib/services/router.svelte.ts` |
| `info undefined` in build output | Variadic `logger.info()` builds a `LogEntry` with no `message` | `packages/shared/logger/src/lib/logger_basic.ts` |
| `state_referenced_locally` | `$state(controls)` captured only the initial prop value | `packages/frontend/preview/src/lib/lpc/lpc_preview.svelte` |
| `assetManager.initialize()` timeout at 20s | Content-addressed rehydration loop called `backend.get()` unconditionally for every one of 11,556 cached hashes, even ones the earlier install-state loop had already fetched — a full redundant second pass over the whole catalog, one IPC round trip at a time | `apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts` |
| `registry.setInstallState()` unguarded in `initialize()` | The one DB call in the function not wrapped in `withStepTimeout`, so a stall there couldn't name itself | `apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts` |

Regression tests: `engine/src/pixi_init_options.test.ts` (13 cases),
`engine/src/worker/buffer_rotation.test.ts` (7 cases, reproduces freeze-at-3).

---

## 5. Diagnostic tooling

**`/dev/tauri-test`** — platform probe page. Groups: Viewport metrics, Canvas
allocation, WebGL, Render loop, Workers, Asset catalog, Cache backend, Asset
pipeline (real, boot-equivalent). Every call is bounded so a hang reports
instead of hanging the page. **Copy report** button dumps it all as text.
Launch straight into this route rather than visiting `/game` first in the
same session — the pipeline result is memoized, so a prior boot in the same
process makes the "Asset pipeline" group report a cached result instead of a
fresh timing.

**`withStepTimeout`** (`apps/frontend/client/src/lib/utils/step_timeout.ts`) —
races each boot step against a deadline and names the one that stalls, because
intermediate logging is `debug` and invisible at the default `INFO` level.
Budgets: 20s in `asset_prefetch_service`, 8s per call inside `asset_manager` so
the inner, more specific name wins. `seedFromCompactSeed` is deliberately *not*
wrapped — it can legitimately run long and reports its own chunk progress.

**Launcher flags** (`scripts/src/lib/ops/run_tauri.ts`): `--route /x` (aliases
`--init-route`, `--path`), `--software-gl`, `--gdk-scale N`, `--dry-run`.
Unknown flags warn instead of being silently dropped.

---

## 6. How to test

```bash
# 1. Build a REAL production binary. Without --mode it defaults to `emulator`,
#    which points the hub API at a dead localhost:5276.
bun moon run client:tauri-build -- --mode production

# 2. Diagnostic page — read the "Cache backend" group first.
bun moon run client:tauri-run -- --route /dev/tauri-test

# 3. Boot the game and capture the named hanging step.
bun moon run client:tauri-run     # then navigate to /game

# 4. Validate before committing.
bun moon run frontend-engine:typecheck client:typecheck
bunx biome check <paths>
cd packages/frontend/engine && bun test

# Cloudflare checks
cd scripts && bun cf r2 buckets cors get aikami-catalog
```

The WebKit inspector is enabled via the `devtools` feature on the `tauri` crate
in `src-tauri/Cargo.toml`. Console output is also forwarded to the terminal by
`tauri-plugin-log`.

---

## 7. Outstanding data needed

Captured so far:

1. **`Cache backend` probe from `/dev/tauri-test`** (2026-08-27): all-pass,
   backend `tauri-fs`, per-call timings 1-120ms across several runs
   (noisy but never slow), 11,556-12,726 entries depending on catalog
   version. Confirms the backend itself is fast; ruled out as the direct
   cause (see §1).
2. **`/game` boot, pre-any-fix** (2026-08-27): reproduced
   `asset registry step "assetManager.initialize" did not settle within
   20000ms` at `/dev/sandbox`. Pinned the cause on call volume inside
   `initialize()` rather than backend latency.
3. **`/game` boot, after the loop-2 redundant-pass fix only**: still timed
   out, but the `[AssetManager] asset_manager:initialized` debug log appeared
   ~20s after the failure was reported — proved the promise was slow, not
   hung, and pointed at loop 1's fully-sequential per-item fetch.
4. **`Asset pipeline` probe from `/dev/tauri-test`, after the concurrency-24
   fix** (2026-08-27, real 12,726-row catalog): `ensureRegistryReady()` total
   **16,644ms** — under the 20s budget, WARN-level margin. This is what
   justified raising concurrency to 64 (§1) rather than declaring victory.
5. **`Asset pipeline` probe at concurrency 64** (2026-08-27): **16,686ms —
   no measurable change from 24.** Confirmed concurrency was not the lever
   and motivated round 4 (the `coreTags` fix, §1).
6. **`Asset pipeline` probe after the round-4 `coreTags` fix** (2026-08-27,
   real 12,726-row catalog): **1,422ms.** PASS, well under budget.
7. **Full `/dev/sandbox` boot on the round-4 build** (2026-08-27): completed
   end to end — `stage:creating_engine:complete`, `loadMap:complete`,
   `stage:hydrating_snapshot:complete`, `stage:spawning_entities:complete`,
   `boot:complete`. No timeout, no degraded stage. **The original hang is
   closed.**

Nothing further needed on the asset-pipeline hang itself. Remaining open
question is the new blank-canvas issue — see §9.

---

## 8. Landmines

- **Debug logs are hidden by default.** `PUBLIC_LOG_LEVEL` defaults to `INFO`.
  Currently set to `DEBUG` in `.env.production` for this investigation.
- **Debug-only settings are live in `.env.production`**: `PUBLIC_ERUDA_ENABLED=1`
  (ships ~490KB of devtools, source of the canvas-limit warnings) and
  `PUBLIC_LOG_LEVEL=DEBUG`. Both intentional for debugging — revert before release.
- **Dev routes ship to production.** `includeDevRoutes` is hardcoded `true` in
  `vite.config.ts` behind a TODO. The commented-out expression is also inverted.
- **`--route` needs a per-route opt-in on release builds.** The app is a pure SPA
  (`ssr = false, prerender = false`), so no per-route HTML is emitted and Tauri's
  asset protocol resolves the path literally. A route needs a `+page.ts` exporting
  `prerender = true` and `trailingSlash = 'always'` to emit
  `dev/<name>/index.html`. Only `tauri-test` has this.
- **The GL renderer string is meaningless.** WebKit masks it and reports
  `Apple GPU` on every platform, Linux included. It cannot confirm whether
  `--software-gl` took effect.
- **A canvas keeps its first context type.** Probing `webgl` after `webgl2` on the
  same canvas always returns `null`. Use a fresh canvas per type.
- **Some unit tests fail on `main` already** — roughly a third, from a
  `bun test --tsconfig` path-mapping issue with extension-qualified dynamic
  imports. Pre-existing, tracked in `docs/TODO.md`. Confirm against a stash
  before attributing a failure to your change.

---

## 9. NEW, OPEN: blank canvas after a fully successful boot

Discovered 2026-08-27 once the asset-pipeline hang (§1) was fixed — boot now
completes fast and cleanly, but `/dev/sandbox` shows an **empty canvas**. No
error is logged anywhere in the pipeline.

**What the boot log shows (all present, in order, no gaps):**
`stage:creating_engine:complete` → `loadMap:terrain-resolved` →
`loadMap:tilemap-rendered` → `[GameWorld] worker bootstrap loaded` →
`ENTITY_CREATED` ×4 → `entity-added-to-stage` ×4 → `appearance-changed` →
`prop-frame-texture-loaded` ×3 → `stage:hydrating_snapshot:complete` →
`stage:spawning_entities:complete` → `boot:complete`. The ECS worker is
alive and ticking (`tickLoop:starvation-copy`, `recycleBuffer:discard`
firing repeatedly — worth a look but likely just buffer-pool churn under
normal load, not yet confirmed either way).

**Ruled out already, with evidence:**
- **Canvas allocation refused** (the WebKitGTK silent-refusal bug from §2) —
  `[GameWorld] initialize:canvas-allocated` logged (not
  `canvas-allocation-refused`), meaning `canvas.width/height` matched what
  the renderer expected. Canvas was a real size, not the 300×150 tell.
- **Corrupt `devicePixelRatio` reaching Pixi's `resolution`** —
  `pixi_init_options.ts:137-138` already clamps/guards this (tests:
  `pixi_init_options.test.ts` "keeps a negative devicePixelRatio from
  reaching resolution"). `GameWorld` also independently detects unusable
  window metrics (`initialize:unusable-window-metrics` logged, as expected)
  and falls back off `resizeTo: window` per the `hasUsableWindowMetrics`
  gate in `game_world.ts:604-616`.
- **WebGL unavailable** — `/dev/tauri-test` probe: webgl2 available,
  `MAX_TEXTURE_SIZE` 32768.
- **rAF not firing** — probe: 33 frames/500ms.
- **Asset pipeline not completing** — this session's own fix; boot reaches
  `boot:complete`.

**Not yet checked:**
- A screenshot of the actual blank state (nothing visual has been captured
  this session — everything above is log-only).
- Whether this reproduces on `aikami.bearlysleeping.com` (Web/OPFS) with the
  same map/route, or is Tauri/WebKitGTK-specific — this is the single most
  useful next data point, since it splits the hypothesis space in half
  (engine-wide regression vs. platform-specific rendering issue).
- The `tickLoop:starvation-copy` / `recycleBuffer:discard` spam — §4's
  "N-buffer rotation deadlock" bug (already fixed, in `ecs_worker.ts`) was
  in this exact area. Worth checking whether this is normal steady-state
  chatter or a symptom of buffers never actually reaching the renderer
  (i.e., world state ticks but the main-thread copy the renderer reads from
  never gets fresh data — would produce exactly "engine alive, nothing
  draws").
- Camera/world-container transform: `game_world.ts:665` sets
  `this._worldContainer.scale.set(4)` and centers on the player dynamically
  in `_updateRenderFromBuffer` — not yet checked whether that function is
  actually running post-boot, or whether the camera ends up pointed
  somewhere with no visible entities (e.g. a NaN/zero position from a stale
  or never-populated buffer).

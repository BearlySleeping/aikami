// apps/frontend/client/src/routes/(dev)/dev/tauri-test/tauri_test_view_model.svelte.ts
//
// Platform diagnostic probes for the Tauri desktop webview.
//
// Exists because a blank game canvas on WebKitGTK produces almost no signal:
// nothing throws, the DOM overlay renders fine, and the only console output
// is a warning WebKit attributes to whichever canvas happened to be biggest.
// Each probe below isolates one layer (viewport metrics -> canvas allocation
// -> WebGL -> rAF -> worker) so a failure names itself instead of surfacing
// as "the map is black".
//
// Launch straight into it:
//   bun moon run client:tauri-run -- --route /dev/tauri-test

import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services';

/** Outcome of a single probe. `warn` = works, but not the expected value. */
export type ProbeStatus = 'pass' | 'warn' | 'fail' | 'pending';

export type ProbeRow = {
  readonly label: string;
  readonly value: string;
  readonly status: ProbeStatus;
  /** Why this value matters — shown under the row when not 'pass'. */
  readonly note?: string;
};

export type ProbeGroup = {
  readonly title: string;
  readonly rows: ProbeRow[];
};

/** WebKit refuses a canvas whose backing store exceeds 2^28 pixels. */
const MAX_CANVAS_AREA = 268_435_456;

/** A dimension usable as a canvas axis. */
const isUsableDimension = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const format = (value: unknown): string => {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toPrecision(10);
  }
  return String(value);
};

export type TauriTestViewModelInterface = BaseDevViewModelInterface & {
  readonly groups: ProbeGroup[];
  readonly running: boolean;
  readonly report: string;
  runProbes: () => Promise<void>;
};

class TauriTestViewModel
  extends BaseDevViewModel<BaseDevViewModelOptions>
  implements TauriTestViewModelInterface
{
  groups = $state<ProbeGroup[]>([]);
  running = $state(false);

  /** The whole page as plain text, for pasting into a bug report. */
  report = $derived(
    this.groups
      .map((group) => {
        const rows = group.rows
          .map((row) => `  [${row.status.toUpperCase()}] ${row.label}: ${row.value}`)
          .join('\n');
        return `${group.title}\n${rows}`;
      })
      .join('\n\n'),
  );

  override async initialize(): Promise<void> {
    void this.runProbes();
    return await super.initialize();
  }

  async runProbes(): Promise<void> {
    this.running = true;
    try {
      const viewport = await this._probeViewport();
      this.groups = [
        viewport.group,
        this._probeCanvasAllocation(viewport.nativeSize),
        this._probeWebGl(),
        await this._probeRaf(),
        await this._probeWorker(),
        await this._probeAssetCatalog(),
      ];
    } catch (error) {
      this.error('tauriTest.probesFailed', { error: String(error) });
    } finally {
      this.running = false;
    }
  }

  /**
   * DOM viewport metrics vs Tauri's native window API.
   *
   * The native size comes over IPC from Rust, so it bypasses whatever
   * corrupts the DOM getters. When the two disagree, every downstream
   * consumer of window.innerWidth (Pixi's resizeTo, autoDensity, CSS vh)
   * is working from the corrupt value.
   */
  private async _probeViewport(): Promise<{
    group: ProbeGroup;
    nativeSize: { width: number; height: number } | undefined;
  }> {
    const rows: ProbeRow[] = [];
    const dpr = window.devicePixelRatio;
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;
    const clientWidth = document.documentElement.clientWidth;
    const clientHeight = document.documentElement.clientHeight;

    const dprOk = isUsableDimension(dpr);
    rows.push({
      label: 'window.devicePixelRatio',
      value: format(dpr),
      status: dprOk ? 'pass' : 'fail',
      note: dprOk
        ? undefined
        : 'Negative or zero. Every other DOM metric is derived from this, so it is the ' +
          'upstream fault. -1/96 (≈ -0.0104) means GDK handed the webview a negative scale factor.',
    });

    for (const [label, value] of [
      ['window.innerWidth', innerWidth],
      ['window.innerHeight', innerHeight],
      ['documentElement.clientWidth', clientWidth],
      ['documentElement.clientHeight', clientHeight],
    ] as const) {
      const ok = isUsableDimension(value) && value < 100_000;
      rows.push({
        label,
        value: format(value),
        status: ok ? 'pass' : 'fail',
        note: ok ? undefined : 'Unusable as a canvas dimension.',
      });
    }

    let nativeSize: { width: number; height: number } | undefined;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const size = await win.innerSize();
      const scale = await win.scaleFactor();
      nativeSize = { width: size.width, height: size.height };
      rows.push({
        label: 'Tauri innerSize() (physical px)',
        value: `${size.width} × ${size.height}`,
        status: isUsableDimension(size.width) ? 'pass' : 'fail',
        note: 'Comes from Rust over IPC — trustworthy when the DOM getters are not.',
      });
      rows.push({
        label: 'Tauri scaleFactor()',
        value: format(scale),
        status: isUsableDimension(scale) ? 'pass' : 'fail',
        note: isUsableDimension(scale)
          ? undefined
          : 'Negative here too means the bad value originates below wry, in GDK. ' +
            'Retry with: bun moon run client:tauri-run -- --gdk-scale 1 --route /dev/tauri-test',
      });
    } catch (error) {
      rows.push({
        label: 'Tauri window API',
        value: String(error),
        status: 'warn',
        note: 'Not running inside Tauri, or the API failed to load.',
      });
    }

    return { group: { title: 'Viewport metrics', rows }, nativeSize };
  }

  /**
   * Allocates canvases and checks what the platform actually gave back.
   *
   * canvas.width is an IDL `unsigned long`: a negative assignment wraps
   * modulo 2^32 into a multi-gigapixel request that WebKit refuses without
   * throwing, leaving the element at its 300×150 default.
   */
  private _probeCanvasAllocation(
    nativeSize: { width: number; height: number } | undefined,
  ): ProbeGroup {
    const rows: ProbeRow[] = [];

    const attempt = (label: string, width: number, height: number, note?: string): void => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const applied = canvas.width === Math.trunc(width) && canvas.height === Math.trunc(height);
      const area = canvas.width * canvas.height;
      rows.push({
        label,
        value: `requested ${format(width)} × ${format(height)} → got ${canvas.width} × ${canvas.height}`,
        status: applied ? 'pass' : 'fail',
        note: applied
          ? note
          : `Refused${area > MAX_CANVAS_AREA ? ' (area over the 2^28 limit)' : ''}. ` +
            '300 × 150 means the assignment was rejected outright.',
      });
    };

    attempt('Fixed 640 × 480', 640, 480, 'Baseline — a failure here means canvas is broken.');
    if (nativeSize) {
      attempt('Tauri native size', nativeSize.width, nativeSize.height);
    }
    attempt('window.inner* size', window.innerWidth, window.innerHeight);

    return { title: 'Canvas allocation', rows };
  }

  /** Whether a GPU context is obtainable at all, and from which driver. */
  private _probeWebGl(): ProbeGroup {
    const rows: ProbeRow[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;

    for (const contextId of ['webgl2', 'webgl'] as const) {
      let context: RenderingContext | null = null;
      try {
        context = canvas.getContext(contextId);
      } catch (error) {
        rows.push({ label: contextId, value: String(error), status: 'fail' });
        continue;
      }
      rows.push({
        label: contextId,
        value: context ? 'available' : 'null',
        status: context ? 'pass' : 'fail',
        note: context ? undefined : 'The engine prefers webgl — a null context renders nothing.',
      });

      if (context && contextId === 'webgl2') {
        const gl = context as WebGL2RenderingContext;
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          rows.push({
            label: 'GL renderer',
            value: String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)),
            status: 'pass',
          });
        }
        rows.push({
          label: 'MAX_TEXTURE_SIZE',
          value: format(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
          status: 'pass',
        });
      }
    }

    return { title: 'WebGL', rows };
  }

  /**
   * Counts animation frames over ~500ms.
   *
   * Pixi drives every render off rAF. If the compositor considers the
   * window occluded, rAF stops firing and the canvas never repaints — the
   * DOM keeps working, which is exactly the "HUD fine, game black" shape.
   */
  private async _probeRaf(): Promise<ProbeGroup> {
    const frames = await new Promise<number>((resolvePromise) => {
      let count = 0;
      const start = performance.now();
      const tick = (): void => {
        count++;
        if (performance.now() - start >= 500) {
          resolvePromise(count);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      // rAF may never fire at all — do not hang the page waiting for it.
      setTimeout(() => resolvePromise(count), 1500);
    });

    let status: ProbeStatus = 'fail';
    if (frames > 5) {
      status = 'pass';
    } else if (frames > 0) {
      status = 'warn';
    }

    return {
      title: 'Render loop',
      rows: [
        {
          label: 'requestAnimationFrame frames / 500ms',
          value: String(frames),
          status,
          note:
            frames > 5
              ? undefined
              : 'Pixi renders only on rAF. Near-zero here means nothing will ever repaint, ' +
                'no matter how the canvas is sized.',
        },
      ],
    };
  }

  /**
   * Round-trips a message through a Worker built from a blob URL.
   *
   * The ECS simulation lives in a worker; if worker messaging is blocked
   * (CSP worker-src, blob: restrictions) the engine boots and then sits
   * silent, which looks identical to a rendering failure.
   */
  private async _probeWorker(): Promise<ProbeGroup> {
    const rows: ProbeRow[] = [];
    let worker: Worker | undefined;
    try {
      const source = 'self.onmessage = (e) => self.postMessage(e.data);';
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url);
      const started = performance.now();
      const echoed = await new Promise<boolean>((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise(false), 2000);
        (worker as Worker).onmessage = (): void => {
          clearTimeout(timer);
          resolvePromise(true);
        };
        (worker as Worker).postMessage('ping');
      });
      URL.revokeObjectURL(url);
      rows.push({
        label: 'Worker echo round-trip',
        value: echoed ? `${Math.round(performance.now() - started)}ms` : 'timed out (2s)',
        status: echoed ? 'pass' : 'fail',
        note: echoed ? undefined : 'The ECS simulation cannot run without worker messaging.',
      });
    } catch (error) {
      rows.push({ label: 'Worker echo round-trip', value: String(error), status: 'fail' });
    } finally {
      worker?.terminate();
    }

    const transferable = (() => {
      try {
        const buffer = new ArrayBuffer(8);
        structuredClone(buffer, { transfer: [buffer] });
        return buffer.byteLength === 0;
      } catch {
        return false;
      }
    })();
    rows.push({
      label: 'ArrayBuffer transfer (detach)',
      value: transferable ? 'supported' : 'NOT detaching',
      status: transferable ? 'pass' : 'fail',
      note: transferable
        ? undefined
        : 'The engine hands entity state to the renderer by transferring buffers.',
    });

    return { title: 'Workers', rows };
  }
  /**
   * Fetches the asset catalog the boot pipeline blocks on.
   *
   * `initializing_asset_registry` is a chain of awaits that logs nothing at
   * production level, so a stalled catalog request surfaced only as a
   * generic 30s stage timeout — and, because the promise is memoized and
   * shared with the start menu, as a permanent "Preparing assets…". This
   * probe issues the same request under its own timeout and reports what
   * actually comes back.
   */
  private async _probeAssetCatalog(): Promise<ProbeGroup> {
    const rows: ProbeRow[] = [];
    const { publicEnv } = await import('@aikami/frontend/configs');
    const baseUrl = publicEnv.PUBLIC_ASSETS_BASE_URL;

    rows.push({
      label: 'PUBLIC_ASSETS_BASE_URL',
      value: baseUrl || '(unset)',
      status: baseUrl ? 'pass' : 'fail',
      note: baseUrl ? undefined : 'Without a base URL no asset can resolve.',
    });

    if (baseUrl) {
      const url = `${baseUrl}/seed/asset_seed.json`;
      const startedAt = performance.now();
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const elapsed = Math.round(performance.now() - startedAt);
        rows.push({
          label: 'GET seed/asset_seed.json',
          value: `${response.status} ${response.statusText} in ${elapsed}ms`,
          status: response.ok ? 'pass' : 'fail',
          note: response.ok
            ? undefined
            : 'The boot pipeline cannot seed the registry without this document.',
        });
      } catch (error) {
        const elapsed = Math.round(performance.now() - startedAt);
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        rows.push({
          label: 'GET seed/asset_seed.json',
          value: `${timedOut ? 'timed out' : String(error)} after ${elapsed}ms`,
          status: 'fail',
          note: timedOut
            ? 'The connection opened and stalled. A bare fetch never settles, which is what ' +
              'hung boot on "Preparing assets…" before the catalog fetch got a timeout.'
            : 'Check the CSP connect-src directive and the origin the host allows — a Tauri ' +
              'webview requests from tauri://localhost, which CORS allowlists rarely include.',
        });
      }
    }

    return { title: 'Asset catalog', rows };
  }
}

export const getTauriTestViewModel = (
  options: BaseDevViewModelOptions,
): TauriTestViewModelInterface => TauriTestViewModel.create(options);

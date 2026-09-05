// apps/frontend/client/src/lib/types/sidecar.ts

/** Client-side lifecycle state for the bundled text-engine sidecar. */
export type SidecarState =
  | { readonly status: 'not-installed' }
  | { readonly status: 'starting' }
  | { readonly status: 'running'; readonly port: number }
  | { readonly status: 'error'; readonly reason: string };

/** Runtime configuration used to launch and health-check the text engine. */
export type TextEngineConfig = {
  readonly host: string;
  readonly port: number;
  readonly binaryName: string;
  readonly modelPath: string;
  readonly healthEndpoint: string;
};

/** Minimal process handle retained by the sidecar lifecycle service. */
export type SidecarChildProcess = {
  kill(): Promise<void>;
};

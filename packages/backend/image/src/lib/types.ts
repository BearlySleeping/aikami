// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/src/lib/types.ts
/**
 * A single node in the ComfyUI API prompt format.
 * This is the JSON shape sent to POST /prompt — keys are string node IDs,
 * values are objects with `inputs` (dynamic dict) and `class_type`.
 */
export type ComfyUIPromptNode = {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title?: string };
};

/** The complete ComfyUI API prompt payload sent to POST /prompt. */
export type ComfyUIPrompt = Record<string, ComfyUIPromptNode>;

/** A link between two nodes in a ComfyUI workflow editor graph. */
export type WorkflowLink = [string, number, string, number, string?];

/** A node definition as stored in the workflow editor graph (GUI format). */
export type WorkflowNodeDef = {
  id: number;
  type: string;
  pos: [number, number] | { x: number; y: number };
  size: { width: number; height: number };
  flags?: Record<string, unknown>;
  order?: number;
  mode?: number;
  inputs?: { name: string; type: string; link: number | null }[];
  outputs?: { name: string; type: string; links: number[] | null }[];
  properties?: Record<string, unknown>;
  widgets_values?: unknown[];
  color?: string;
  bgcolor?: string;
};

/** The complete ComfyUI workflow editor graph (GUI save/load format). */
export type WorkflowGraph = {
  last_node_id: number;
  last_link_id: number;
  nodes: WorkflowNodeDef[];
  links: WorkflowLink[];
  groups?: unknown[];
  config?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  version?: number;
};

/** Configuration for connecting to a ComfyUI instance. */
export type ComfyUIConfig = {
  /** Base URL of the ComfyUI REST API (e.g. 'http://localhost:8188') */
  baseUrl: string;
  /** WebSocket URL (defaults to baseUrl with ws:// protocol) */
  wsUrl?: string;
  /** Maximum time to wait for generation (ms). Default: 120_000. */
  generationTimeoutMs?: number;
};

/** Response from POST /prompt. */
export type PromptResponse = {
  prompt_id: string;
  number: number;
  node_errors?: Record<
    string,
    {
      class_type: string;
      dependent_outputs: string[];
      errors: Array<{ details: string; extra_info?: unknown; message: string; type: string }>;
    }
  >;
};

/** Response from GET /history/{prompt_id}. */
export type HistoryResponse = Record<string, HistoryEntry>;

export type HistoryEntry = {
  prompt: [number, string, Record<string, unknown>];
  outputs: Record<string, HistoryOutput>;
  status?: {
    status_str: string;
    completed: boolean;
    messages?: [string, Record<string, unknown>][];
  };
};

export type HistoryOutput = {
  images?: Array<{
    filename: string;
    subfolder: string;
    type: string;
  }>;
};

/** Result of a completed generation cycle. */
export type GenerationResult = {
  /** Raw image bytes (PNG or JPEG). */
  imageData: Uint8Array;
  /** MIME type of the image data. */
  mimeType: string;
  /** The prompt ID assigned by ComfyUI. */
  promptId: string;
};

/** Options for the ImageGenerationOrchestrator. */
export type OrchestratorOptions = {
  config: ComfyUIConfig;
  /** AbortController for cancelling in-flight generations. */
  signal?: AbortSignal;
  /** Override the generation timeout (ms). */
  generationTimeoutMs?: number;
};

/** Status of a WebSocket-backed generation run. */
export type GenerationStatus =
  | { state: 'pending' }
  | { state: 'executing'; node: string }
  | { state: 'completed'; imageData: Uint8Array; mimeType: string }
  | { state: 'failed'; error: string }
  | { state: 'timed_out' };

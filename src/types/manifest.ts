/** stubber-json manifest v1 */
export interface ManifestV1 {
  version: 1;
  sourceFileName: string;
  originalSha256: string;
  /** Spaces per indent level detected from source (e.g. 2 or 4) */
  indentSize: number;
  /** Top-level JSON keys in document order */
  topLevelKeyOrder: string[];
  /** Key order for object at JSON Pointer path (e.g. /actions) */
  objectKeyOrders: Record<string, string[]>;
  files: ManifestFileEntry[];
}

export interface ManifestFileEntry {
  /** Path relative to project root */
  path: string;
  sha256: string;
  kind:
    | "original"
    | "details"
    | "data"
    | "annotations"
    | "action"
    | "task"
    | "task_code"
    | "notification"
    | "field"
    | "state"
    | "state_hook_task"
    | "project_meta";
  /** JSON Pointer to parent object this file merges into */
  mergePointer?: string;
  /** For tasks: task key name */
  taskKey?: string;
  actionKey?: string;
  stateKey?: string;
  hookPhase?: "on_enter_state" | "in_state" | "on_exit_state";
  /** For code tasks: which param paths received the same extracted body */
  codeSlots?: ("params.code" | "params.code_execution.code_block")[];
}

export interface ProjectMeta {
  schema: "stubber-exploded-project";
  version: 1;
  sourceFileName: string;
  explodedAt: string;
}

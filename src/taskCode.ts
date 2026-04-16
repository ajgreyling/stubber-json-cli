import type { JsonObject } from "./types/json.js";
import { isPlainObject } from "./types/json.js";

export function injectCodeIntoTask(
  task: JsonObject,
  code: string,
  slots: ("params.code" | "params.code_execution.code_block")[],
): void {
  if (!isPlainObject(task.params)) task.params = {};
  const params = task.params as JsonObject;
  if (slots.includes("params.code")) {
    params.code = code;
  }
  if (slots.includes("params.code_execution.code_block")) {
    if (!isPlainObject(params.code_execution)) params.code_execution = {};
    (params.code_execution as JsonObject).code_block = code;
  }
  if (slots.length === 0 && task.tasktype === "code") {
    params.code = code;
    if (!isPlainObject(params.code_execution)) params.code_execution = {};
    (params.code_execution as JsonObject).code_block = code;
  }
}

export function inferCodeSlotsFromManifest(
  entries: {
    kind?: string;
    taskKey?: string;
    actionKey?: string;
    stateKey?: string;
    hookPhase?: string;
    codeSlots?: string[];
  }[],
  match: { taskKey: string; actionKey?: string; stateKey?: string; hookPhase?: string },
): ("params.code" | "params.code_execution.code_block")[] {
  const hit = entries.find(
    (e) =>
      e.kind === "task_code" &&
      e.taskKey === match.taskKey &&
      (e.actionKey ?? "") === (match.actionKey ?? "") &&
      (e.stateKey ?? "") === (match.stateKey ?? "") &&
      (e.hookPhase ?? "") === (match.hookPhase ?? "") &&
      Array.isArray(e.codeSlots),
  );
  if (hit?.codeSlots?.length) {
    return hit.codeSlots as ("params.code" | "params.code_execution.code_block")[];
  }
  return [];
}

import { copyFile, readFile, writeFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ManifestV1 } from "./types/manifest.js";
import { loadManifest, verifyManifestFiles } from "./manifestIo.js";
import { joinPointer } from "./utils/jsonPointer.js";
import { stringifyWithKeyOrders } from "./utils/orderedStringify.js";
import { safeSegment } from "./utils/slug.js";
import { inferCodeSlotsFromManifest, injectCodeIntoTask } from "./taskCode.js";
import type { JsonObject } from "./types/json.js";
import { isPlainObject } from "./types/json.js";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Strip trailing newline from code file for injection */
function normalizeCodeFileContent(s: string): string {
  return s.replace(/\n$/, "");
}

export { loadManifest, verifyManifestFiles } from "./manifestIo.js";

async function readJsonIfExists<T = unknown>(p: string): Promise<T | null> {
  if (!(await pathExists(p))) return null;
  return JSON.parse(await readFile(p, "utf8")) as T;
}

function parseTaskFileBase(name: string): { prefix: string; key: string } | null {
  const m = /^(.+?)__(.+)\.json$/.exec(name);
  if (!m) return null;
  return { prefix: m[1], key: m[2] };
}

async function mergeTasksFromDisk(
  projectDir: string,
  baseRelDir: string,
  tasksOrderPointer: string,
  manifest: ManifestV1,
  scope: { actionKey?: string; stateKey?: string; hookPhase?: string },
): Promise<JsonObject> {
  const tasksDir = path.join(projectDir, baseRelDir, "tasks");
  const tasksCodeDir = path.join(projectDir, baseRelDir, "tasks-code");
  const merged: JsonObject = {};
  if (!(await pathExists(tasksDir))) return merged;

  const byFile = new Map<string, JsonObject>();
  const jsonFiles = (await readdir(tasksDir)).filter((f) => f.endsWith(".json"));
  for (const jf of jsonFiles) {
    const task = (await readJsonIfExists<JsonObject>(path.join(tasksDir, jf))) ?? {};
    const base = jf.replace(/\.json$/, "");
    const codePath = path.join(tasksCodeDir, `${base}.js`);
    if (await pathExists(codePath)) {
      const codeRaw = await readFile(codePath, "utf8");
      const code = normalizeCodeFileContent(codeRaw);
      const taskKey = typeof task.__key === "string" ? task.__key : parseTaskFileBase(jf)?.key ?? "";
      const slots = inferCodeSlotsFromManifest(manifest.files, {
        taskKey,
        actionKey: scope.actionKey,
        stateKey: scope.stateKey,
        hookPhase: scope.hookPhase,
      });
      injectCodeIntoTask(task, code, slots);
    }
    const taskKey =
      (typeof task.__key === "string" && task.__key) || parseTaskFileBase(jf)?.key || base;
    byFile.set(taskKey, task);
  }
  const order = manifest.objectKeyOrders[tasksOrderPointer] ?? [...byFile.keys()].sort();
  for (const taskKey of order) {
    const t = byFile.get(taskKey);
    if (t) merged[taskKey] = t;
  }
  for (const taskKey of byFile.keys()) {
    if (!Object.prototype.hasOwnProperty.call(merged, taskKey)) merged[taskKey] = byFile.get(taskKey)!;
  }
  return merged;
}

async function mergeKeyedJsonDir(
  projectDir: string,
  dirRel: string,
  orderPointer: string,
  manifest: ManifestV1,
): Promise<JsonObject> {
  const full = path.join(projectDir, dirRel);
  if (!(await pathExists(full))) return {};
  const merged: JsonObject = {};
  const byKey = new Map<string, JsonObject>();
  const files = (await readdir(full)).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const obj = (await readJsonIfExists<JsonObject>(path.join(full, f))) ?? {};
    const base = f.replace(/\.json$/, "");
    const key =
      (typeof obj.__key === "string" && obj.__key) || parseTaskFileBase(f)?.key || base;
    byKey.set(key, obj);
  }
  const order = manifest.objectKeyOrders[orderPointer] ?? [...byKey.keys()].sort();
  for (const key of order) {
    const o = byKey.get(key);
    if (o) merged[key] = o;
  }
  for (const key of byKey.keys()) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) merged[key] = byKey.get(key)!;
  }
  return merged;
}

async function rebuildActions(projectDir: string, manifest: ManifestV1): Promise<JsonObject> {
  const actionsRoot = path.join(projectDir, "template", "actions");
  if (!(await pathExists(actionsRoot))) return {};
  const order = manifest.objectKeyOrders[joinPointer("actions")] ?? (await readdir(actionsRoot)).sort();
  const actions: JsonObject = {};
  for (const actionKey of order) {
    const seg = safeSegment(actionKey);
    const dir = path.join(actionsRoot, seg);
    if (!(await pathExists(dir))) continue;
    const actionPath = path.join(dir, "action.json");
    const baseAction = (await readJsonIfExists<JsonObject>(actionPath)) ?? {};
    const tasksPtr = joinPointer("actions", actionKey, "tasks");
    const tasks = await mergeTasksFromDisk(
      projectDir,
      path.join("template", "actions", seg),
      tasksPtr,
      manifest,
      {
        actionKey,
      },
    );
    const notifPtr = joinPointer("actions", actionKey, "notifications");
    const notifications = await mergeKeyedJsonDir(
      projectDir,
      path.join("template", "actions", seg, "notifications"),
      notifPtr,
      manifest,
    );
    const fieldsPtr = joinPointer("actions", actionKey, "fields");
    const fields = await mergeKeyedJsonDir(
      projectDir,
      path.join("template", "actions", seg, "fields"),
      fieldsPtr,
      manifest,
    );
    actions[actionKey] = {
      ...baseAction,
      tasks,
      notifications,
      fields,
    };
  }
  return actions;
}

async function rebuildStates(projectDir: string, manifest: ManifestV1): Promise<JsonObject> {
  const statesRoot = path.join(projectDir, "template", "states");
  if (!(await pathExists(statesRoot))) return {};
  const order = manifest.objectKeyOrders[joinPointer("states")] ?? (await readdir(statesRoot)).sort();
  const states: JsonObject = {};
  for (const stateKey of order) {
    const seg = safeSegment(stateKey);
    const statePath = path.join(statesRoot, seg, "state.json");
    const state = (await readJsonIfExists<JsonObject>(statePath)) ?? {};
    const hooks = isPlainObject(state.state_hooks) ? (state.state_hooks as JsonObject) : null;
    if (hooks) {
      for (const phase of ["on_enter_state", "in_state", "on_exit_state"] as const) {
        const h = hooks[phase];
        if (!isPlainObject(h)) continue;
        const hookBase = path.join("template", "states", seg, "hooks", phase);
        const tasksPtr = joinPointer("states", stateKey, "state_hooks", phase, "tasks");
        const tasks = await mergeTasksFromDisk(projectDir, hookBase, tasksPtr, manifest, {
          stateKey,
          hookPhase: phase,
        });
        if (Object.keys(tasks).length > 0) {
          (h as JsonObject).tasks = tasks;
        }
      }
    }
    states[stateKey] = state;
  }
  return states;
}

async function rebuildAnnotations(projectDir: string, manifest: ManifestV1): Promise<JsonObject | undefined> {
  const annDir = path.join(projectDir, "template", "annotations");
  if (!(await pathExists(annDir))) return undefined;
  const ptr = joinPointer("annotations");
  const keys =
    manifest.objectKeyOrders[ptr] ??
    (await readdir(annDir)).map((f) => f.replace(/\.json$/, ""));
  const ann: JsonObject = {};
  for (const k of keys) {
    const seg = safeSegment(k);
    const file = path.join(annDir, `${seg}.json`);
    const alt = path.join(annDir, `${k}.json`);
    const p = (await pathExists(file)) ? file : (await pathExists(alt)) ? alt : null;
    if (!p) continue;
    ann[k] = JSON.parse(await readFile(p, "utf8")) as unknown;
  }
  return ann;
}

export async function implodeProject(projectDir: string, outputJsonPath: string): Promise<{ byteExact: boolean }> {
  const manifest = await loadManifest(projectDir);
  const unchanged = await verifyManifestFiles(projectDir, manifest);
  if (unchanged) {
    await copyFile(path.join(projectDir, ".stubber", "original.json"), outputJsonPath);
    return { byteExact: true };
  }

  const root: JsonObject = {};
  for (const k of manifest.topLevelKeyOrder) {
    if (k === "actions") {
      root.actions = await rebuildActions(projectDir, manifest);
    } else if (k === "states") {
      root.states = await rebuildStates(projectDir, manifest);
    } else if (k === "details") {
      const d = await readJsonIfExists(path.join(projectDir, "template", "details.json"));
      if (d !== null) root.details = d;
    } else if (k === "data") {
      const d = await readJsonIfExists(path.join(projectDir, "template", "data.json"));
      if (d !== null) root.data = d;
    } else if (k === "annotations") {
      const a = await rebuildAnnotations(projectDir, manifest);
      if (a !== undefined) root.annotations = a;
    } else {
      const orig = JSON.parse(
        (await readFile(path.join(projectDir, ".stubber", "original.json"))).toString("utf8"),
      ) as JsonObject;
      if (Object.prototype.hasOwnProperty.call(orig, k)) {
        root[k] = orig[k];
      }
    }
  }

  const body = `${stringifyWithKeyOrders(root, manifest.indentSize, manifest.objectKeyOrders, "")}\n`;
  await writeFile(outputJsonPath, body, "utf8");
  return { byteExact: false };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ManifestFileEntry, ManifestV1, ProjectMeta } from "./types/manifest.js";
import type { JsonObject } from "./types/json.js";
import { isPlainObject } from "./types/json.js";
import { sha256Hex } from "./utils/hash.js";
import { detectIndentSize } from "./utils/indent.js";
import { joinPointer } from "./utils/jsonPointer.js";
import { safeSegment, taskFilePrefix } from "./utils/slug.js";
import { stringifyWithKeyOrders } from "./utils/orderedStringify.js";
import { renderWorkflowFsmMarkdown } from "./workflowFsmMermaid.js";

function sortKeysByStubOrder(obj: JsonObject): string[] {
  return Object.keys(obj).sort((a, b) => {
    const oa = isPlainObject(obj[a]) ? Number((obj[a] as JsonObject).__order ?? 0) : 0;
    const ob = isPlainObject(obj[b]) ? Number((obj[b] as JsonObject).__order ?? 0) : 0;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
}

interface CodeExtractResult {
  taskWithoutCode: JsonObject;
  code: string | null;
  codeSlots: ("params.code" | "params.code_execution.code_block")[];
}

function extractCodeFromTask(task: JsonObject): CodeExtractResult {
  const taskWithoutCode = JSON.parse(JSON.stringify(task)) as JsonObject;
  const slots: ("params.code" | "params.code_execution.code_block")[] = [];
  const t = taskWithoutCode;
  if (t.tasktype !== "code") {
    return { taskWithoutCode: t, code: null, codeSlots: [] };
  }
  const params = isPlainObject(t.params) ? t.params : null;
  if (!params) return { taskWithoutCode: t, code: null, codeSlots: [] };

  let codeFromBlock: string | undefined;
  let codeFromParams: string | undefined;
  const ce = params.code_execution;
  if (isPlainObject(ce) && typeof ce.code_block === "string") {
    codeFromBlock = ce.code_block;
  }
  if (typeof params.code === "string") {
    codeFromParams = params.code;
  }

  if (codeFromBlock !== undefined) {
    delete (params as { code_execution?: unknown }).code_execution;
    if (isPlainObject(ce)) {
      const ce2 = { ...ce };
      delete (ce2 as { code_block?: unknown }).code_block;
      if (Object.keys(ce2).length > 0) {
        (params as { code_execution: unknown }).code_execution = ce2;
      }
    }
    slots.push("params.code_execution.code_block");
  }
  if (codeFromParams !== undefined) {
    delete (params as { code?: unknown }).code;
    slots.push("params.code");
  }

  const code =
    codeFromBlock !== undefined
      ? codeFromBlock
      : codeFromParams !== undefined
        ? codeFromParams
        : null;

  return { taskWithoutCode: t, code, codeSlots: slots };
}

export async function explodeProject(
  inputJsonPath: string,
  outputDir: string,
): Promise<{ manifest: ManifestV1; wroteBytes: number }> {
  const buf = await readFile(inputJsonPath);
  const text = buf.toString("utf8");
  const originalSha256 = sha256Hex(buf);
  const indentSize = detectIndentSize(text);
  const root = JSON.parse(text) as unknown;
  if (!isPlainObject(root)) {
    throw new Error("Root JSON must be an object");
  }

  const topLevelKeyOrder = Object.keys(root);
  const objectKeyOrders: Record<string, string[]> = { "": topLevelKeyOrder };
  const files: ManifestFileEntry[] = [];

  const recordFile = async (relPath: string, body: string | Buffer, entry: Omit<ManifestFileEntry, "path" | "sha256">) => {
    const full = path.join(outputDir, relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    const hash = sha256Hex(typeof body === "string" ? Buffer.from(body, "utf8") : body);
    files.push({ path: relPath, sha256: hash, ...entry });
  };

  await mkdir(outputDir, { recursive: true });
  await mkdir(path.join(outputDir, ".stubber"), { recursive: true });
  await mkdir(path.join(outputDir, "template"), { recursive: true });

  await recordFile(".stubber/original.json", buf, { kind: "original" });

  const sourceFileName = path.basename(inputJsonPath);

  const meta: ProjectMeta = {
    schema: "stubber-exploded-project",
    version: 1,
    sourceFileName,
    explodedAt: new Date().toISOString(),
  };
  const metaBody = `${JSON.stringify(meta, null, 2)}\n`;
  await recordFile("project.json", metaBody, { kind: "project_meta" });

  const templateRoot = path.join(outputDir, "template");
  await mkdir(templateRoot, { recursive: true });

  /** Record key order for a plain object at pointer */
  const recordOrder = (pointer: string, obj: JsonObject) => {
    objectKeyOrders[pointer] = Object.keys(obj);
  };

  recordOrder("", root);

  if ("details" in root && root.details !== undefined) {
    const ptr = joinPointer("details");
    if (isPlainObject(root.details)) recordOrder(ptr, root.details as JsonObject);
    const body = `${stringifyWithKeyOrders(root.details, indentSize, objectKeyOrders, ptr)}\n`;
    await recordFile("template/details.json", body, { kind: "details", mergePointer: ptr });
  }

  if ("data" in root && root.data !== undefined) {
    const ptr = joinPointer("data");
    if (isPlainObject(root.data)) recordOrder(ptr, root.data as JsonObject);
    const body = `${stringifyWithKeyOrders(root.data, indentSize, objectKeyOrders, ptr)}\n`;
    await recordFile("template/data.json", body, { kind: "data", mergePointer: ptr });
  }

  if ("annotations" in root && root.annotations !== undefined) {
    const ann = root.annotations;
    const ptr = joinPointer("annotations");
    if (isPlainObject(ann)) {
      const annObj = ann as JsonObject;
      recordOrder(ptr, annObj);
      await mkdir(path.join(outputDir, "template", "annotations"), { recursive: true });
      const annKeys = Object.keys(annObj);
      for (const annKey of annKeys) {
        const ap = joinPointer("annotations", annKey);
        const sub = annObj[annKey];
        if (isPlainObject(sub)) recordOrder(ap, sub);
        const body = `${stringifyWithKeyOrders(sub, indentSize, objectKeyOrders, ap)}\n`;
        const seg = safeSegment(annKey);
        await recordFile(`template/annotations/${seg}.json`, body, {
          kind: "annotations",
          mergePointer: ap,
        });
      }
    }
  }

  if (isPlainObject(root.actions)) {
    const actions = root.actions as JsonObject;
    const actionsPtr = joinPointer("actions");
    recordOrder(actionsPtr, actions);
    const actionKeys = Object.keys(actions);
    for (const actionKey of actionKeys) {
      const action = actions[actionKey];
      if (!isPlainObject(action)) continue;
      const actionPtr = joinPointer("actions", actionKey);
      recordOrder(actionPtr, action);

      const actionDir = path.join("template", "actions", safeSegment(actionKey));
      const tasks = isPlainObject(action.tasks) ? (action.tasks as JsonObject) : {};
      const notifications = isPlainObject(action.notifications)
        ? (action.notifications as JsonObject)
        : {};
      const fields = isPlainObject(action.fields) ? (action.fields as JsonObject) : {};

      const taskOrder = sortKeysByStubOrder(tasks);
      const tasksPtr = joinPointer("actions", actionKey, "tasks");
      objectKeyOrders[tasksPtr] = taskOrder;

      const actionBody: JsonObject = { ...action };
      actionBody.tasks = {};
      actionBody.notifications = {};
      actionBody.fields = {};

      const actionJson = `${stringifyWithKeyOrders(actionBody, indentSize, objectKeyOrders, actionPtr)}\n`;
      await recordFile(path.join(actionDir, "action.json"), actionJson, {
        kind: "action",
        mergePointer: actionPtr,
        actionKey,
      });

      for (const taskKey of taskOrder) {
        const task = tasks[taskKey];
        if (!isPlainObject(task)) continue;
        const taskPtr = joinPointer("actions", actionKey, "tasks", taskKey);
        recordOrder(taskPtr, task);
        const ord = task.__order ?? 0;
        const prefix = taskFilePrefix(ord as number);
        const { taskWithoutCode, code, codeSlots } = extractCodeFromTask(task);
        const taskJson = `${stringifyWithKeyOrders(taskWithoutCode, indentSize, objectKeyOrders, taskPtr)}\n`;
        const taskRel = path.join(actionDir, "tasks", `${prefix}__${safeSegment(taskKey)}.json`);
        await recordFile(taskRel, taskJson, {
          kind: "task",
          mergePointer: taskPtr,
          actionKey,
          taskKey,
          codeSlots: codeSlots.length ? codeSlots : undefined,
        });
        if (code !== null) {
          const codeRel = path.join(actionDir, "tasks-code", `${prefix}__${safeSegment(taskKey)}.js`);
          const codeBody = `${code}\n`;
          await recordFile(codeRel, codeBody, {
            kind: "task_code",
            mergePointer: taskPtr,
            actionKey,
            taskKey,
            codeSlots,
          });
        }
      }

      const notifOrder = sortKeysByStubOrder(notifications);
      const notifPtr = joinPointer("actions", actionKey, "notifications");
      objectKeyOrders[notifPtr] = notifOrder;
      for (const nk of notifOrder) {
        const nv = notifications[nk];
        const nPtr = joinPointer("actions", actionKey, "notifications", nk);
        if (isPlainObject(nv)) recordOrder(nPtr, nv as JsonObject);
        const body = `${stringifyWithKeyOrders(nv, indentSize, objectKeyOrders, nPtr)}\n`;
        const no = isPlainObject(nv) ? Number((nv as JsonObject).__order ?? 0) : 0;
        const prefix = taskFilePrefix(no);
        await recordFile(path.join(actionDir, "notifications", `${prefix}__${safeSegment(nk)}.json`), body, {
          kind: "notification",
          mergePointer: nPtr,
          actionKey,
        });
      }

      const fieldOrder = sortKeysByStubOrder(fields);
      const fieldsPtr = joinPointer("actions", actionKey, "fields");
      objectKeyOrders[fieldsPtr] = fieldOrder;
      for (const fk of fieldOrder) {
        const fv = fields[fk];
        const fPtr = joinPointer("actions", actionKey, "fields", fk);
        if (isPlainObject(fv)) recordOrder(fPtr, fv as JsonObject);
        const body = `${stringifyWithKeyOrders(fv, indentSize, objectKeyOrders, fPtr)}\n`;
        const fo = isPlainObject(fv) ? Number((fv as JsonObject).__order ?? 0) : 0;
        const prefix = taskFilePrefix(fo);
        await recordFile(path.join(actionDir, "fields", `${prefix}__${safeSegment(fk)}.json`), body, {
          kind: "field",
          mergePointer: fPtr,
          actionKey,
        });
      }
    }
  }

  if (isPlainObject(root.states)) {
    const states = root.states as JsonObject;
    const statesPtr = joinPointer("states");
    recordOrder(statesPtr, states);
    for (const stateKey of Object.keys(states)) {
      const state = states[stateKey];
      if (!isPlainObject(state)) continue;
      const statePtr = joinPointer("states", stateKey);
      recordOrder(statePtr, state);
      const stateDir = path.join("template", "states", safeSegment(stateKey));
      const stateCopy = JSON.parse(JSON.stringify(state)) as JsonObject;
      const hooks = isPlainObject(stateCopy.state_hooks)
        ? (stateCopy.state_hooks as JsonObject)
        : null;
      const hookPhases = ["on_enter_state", "in_state", "on_exit_state"] as const;

      if (hooks) {
        for (const phase of hookPhases) {
          const h = hooks[phase];
          if (!isPlainObject(h)) continue;
          const ht = h.tasks;
          if (!isPlainObject(ht) || Object.keys(ht).length === 0) continue;
          const tasksPtr = joinPointer("states", stateKey, "state_hooks", phase, "tasks");
          const taskOrder = sortKeysByStubOrder(ht as JsonObject);
          objectKeyOrders[tasksPtr] = taskOrder;
          (h as JsonObject).tasks = {};
          for (const taskKey of taskOrder) {
            const task = (ht as JsonObject)[taskKey];
            if (!isPlainObject(task)) continue;
            const taskPtr = joinPointer("states", stateKey, "state_hooks", phase, "tasks", taskKey);
            recordOrder(taskPtr, task);
            const ord = task.__order ?? 0;
            const prefix = taskFilePrefix(ord as number);
            const { taskWithoutCode, code, codeSlots } = extractCodeFromTask(task);
            const taskJson = `${stringifyWithKeyOrders(taskWithoutCode, indentSize, objectKeyOrders, taskPtr)}\n`;
            const taskRel = path.join(
              stateDir,
              "hooks",
              phase,
              "tasks",
              `${prefix}__${safeSegment(taskKey)}.json`,
            );
            await recordFile(taskRel, taskJson, {
              kind: "state_hook_task",
              mergePointer: taskPtr,
              stateKey,
              hookPhase: phase,
              taskKey,
              codeSlots: codeSlots.length ? codeSlots : undefined,
            });
            if (code !== null) {
              const codeRel = path.join(
                stateDir,
                "hooks",
                phase,
                "tasks-code",
                `${prefix}__${safeSegment(taskKey)}.js`,
              );
              await recordFile(codeRel, `${code}\n`, {
                kind: "task_code",
                mergePointer: taskPtr,
                stateKey,
                hookPhase: phase,
                taskKey,
                codeSlots,
              });
            }
          }
        }
      }

      const stateJson = `${stringifyWithKeyOrders(stateCopy, indentSize, objectKeyOrders, statePtr)}\n`;
      await recordFile(path.join(stateDir, "state.json"), stateJson, {
        kind: "state",
        mergePointer: statePtr,
        stateKey,
      });
    }

    const fsmMd = renderWorkflowFsmMarkdown(root);
    if (fsmMd !== null) {
      const fsmRel = path.join("template", "states", "workflow-fsm.md");
      const fsmFull = path.join(outputDir, fsmRel);
      await mkdir(path.dirname(fsmFull), { recursive: true });
      await writeFile(fsmFull, fsmMd, "utf8");
    }
  }

  const manifest: ManifestV1 = {
    version: 1,
    sourceFileName,
    originalSha256,
    indentSize,
    topLevelKeyOrder,
    objectKeyOrders,
    files,
  };
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(outputDir, ".stubber", "manifest.json"), manifestBody);

  return { manifest, wroteBytes: buf.length };
}

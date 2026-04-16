import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ManifestV1 } from "./types/manifest.js";
import { loadManifest, verifyManifestFiles } from "./manifestIo.js";
import { joinPointer } from "./utils/jsonPointer.js";
import { isPlainObject } from "./types/json.js";
import { sha256Hex } from "./utils/hash.js";

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  manifestByteExactOk: boolean;
}

export async function validateProject(projectDir: string): Promise<ValidateResult> {
  const errors: string[] = [];
  let manifest: ManifestV1;
  try {
    manifest = await loadManifest(projectDir);
  } catch (e) {
    return {
      ok: false,
      errors: [`Cannot read manifest: ${(e as Error).message}`],
      manifestByteExactOk: false,
    };
  }

  const manifestByteExactOk = await verifyManifestFiles(projectDir, manifest);

  const origPath = path.join(projectDir, ".stubber", "original.json");
  let root: Record<string, unknown> = {};
  try {
    const origBuf = await readFile(origPath);
    const h = sha256Hex(origBuf);
    if (h !== manifest.originalSha256) {
      errors.push("original.json SHA256 does not match manifest.originalSha256");
    }
    root = JSON.parse(origBuf.toString("utf8")) as Record<string, unknown>;
  } catch {
    errors.push("Missing or unreadable .stubber/original.json");
  }

  if (isPlainObject(root.states) && isPlainObject(root.actions)) {
    const actions = root.actions as Record<string, unknown>;
    const states = root.states as Record<string, unknown>;
    for (const [sk, st] of Object.entries(states)) {
      if (!isPlainObject(st)) continue;
      const actList = (st as { actions?: unknown }).actions;
      if (!Array.isArray(actList)) continue;
      for (const an of actList) {
        if (typeof an === "string" && !Object.prototype.hasOwnProperty.call(actions, an)) {
          errors.push(`State "${sk}" references unknown action "${an}"`);
        }
      }
    }
  }

  if (!manifest.topLevelKeyOrder?.length) {
    errors.push("manifest.topLevelKeyOrder is empty");
  }

  if (!manifest.objectKeyOrders[joinPointer("actions")] && isPlainObject(root.actions)) {
    errors.push("Missing objectKeyOrders for /actions");
  }

  return {
    ok: errors.length === 0,
    errors,
    manifestByteExactOk,
  };
}

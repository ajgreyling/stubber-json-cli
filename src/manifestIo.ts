import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ManifestV1 } from "./types/manifest.js";
import { sha256Hex } from "./utils/hash.js";

export async function loadManifest(projectDir: string): Promise<ManifestV1> {
  const p = path.join(projectDir, ".stubber", "manifest.json");
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw) as ManifestV1;
}

export async function verifyManifestFiles(projectDir: string, manifest: ManifestV1): Promise<boolean> {
  for (const f of manifest.files) {
    const full = path.join(projectDir, f.path);
    try {
      const buf = await readFile(full);
      if (sha256Hex(buf) !== f.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

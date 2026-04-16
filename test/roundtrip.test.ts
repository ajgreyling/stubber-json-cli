import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { explodeProject } from "../src/explode.js";
import { implodeProject } from "../src/implode.js";
import { validateProject } from "../src/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.resolve(__dirname, "../..");

const samples = [
  "flow-circus-bookings.json",
  "vehicle-service.json",
  "telecoms_suport_agent.json",
  "whatsapp-insurance-assistant.json",
  "document-analyzer.json",
];

describe("explode / implode round-trip", () => {
  for (const name of samples) {
    it(`byte-identical round-trip for ${name}`, async () => {
      const input = path.join(samplesDir, name);
      const original = await readFile(input);
      const work = await mkdtemp(path.join(tmpdir(), "stubber-json-"));
      try {
        await explodeProject(input, work);
        const outPath = path.join(work, "repacked.json");
        const { byteExact } = await implodeProject(work, outPath);
        expect(byteExact).toBe(true);
        const repacked = await readFile(outPath);
        expect(repacked.equals(original)).toBe(true);
        const v = await validateProject(work);
        expect(v.manifestByteExactOk).toBe(true);
        expect(v.ok).toBe(true);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  }

  it("rebuild after editing code file is parseable JSON", async () => {
    const input = path.join(samplesDir, "flow-circus-bookings.json");
    const work = await mkdtemp(path.join(tmpdir(), "stubber-json-edit-"));
    try {
      await explodeProject(input, work);
      const codeDir = path.join(work, "template", "actions", "initiate_ticket_booking", "tasks-code");
      const { readdir } = await import("node:fs/promises");
      const jsName = (await readdir(codeDir)).find((f) => f.endsWith("calculate_amount_total.js"));
      expect(jsName).toBeTruthy();
      const jsPath = path.join(codeDir, jsName!);
      let js = await readFile(jsPath, "utf8");
      js = `// edited\n${js}`;
      await readFile(jsPath); // ensure exists
      const fs = await import("node:fs/promises");
      await fs.writeFile(jsPath, js, "utf8");
      const outPath = path.join(work, "edited.json");
      const { byteExact } = await implodeProject(work, outPath);
      expect(byteExact).toBe(false);
      const parsed = JSON.parse(await readFile(outPath, "utf8"));
      expect(parsed.actions.initiate_ticket_booking.tasks.calculate_amount_total.tasktype).toBe("code");
      expect(
        String(parsed.actions.initiate_ticket_booking.tasks.calculate_amount_total.params.code),
      ).toContain("// edited");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});

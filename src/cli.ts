#!/usr/bin/env node
import path from "node:path";
import { explodeProject } from "./explode.js";
import { implodeProject } from "./implode.js";
import { validateProject } from "./validate.js";

function usage(): void {
  console.error(`stubber-json — Explode / implode Stubber template JSON

Usage:
  stubber-json explode <input.json> <outputDir>
  stubber-json implode <projectDir> <output.json>
  stubber-json validate <projectDir>
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || ["-h", "--help"].includes(cmd)) {
    usage();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === "explode") {
    const input = argv[1];
    const out = argv[2];
    if (!input || !out) {
      usage();
      process.exit(1);
    }
    await explodeProject(path.resolve(input), path.resolve(out));
    console.error(`Exploded to ${path.resolve(out)}`);
    return;
  }
  if (cmd === "implode") {
    const dir = argv[1];
    const output = argv[2];
    if (!dir || !output) {
      usage();
      process.exit(1);
    }
    const { byteExact } = await implodeProject(path.resolve(dir), path.resolve(output));
    console.error(byteExact ? "Wrote output (byte-identical to original)." : "Wrote output (rebuilt from parts).");
    return;
  }
  if (cmd === "validate") {
    const dir = argv[1];
    if (!dir) {
      usage();
      process.exit(1);
    }
    const r = await validateProject(path.resolve(dir));
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempDir = await mkdtemp(path.join(tmpdir(), "taste-match-owner-"));
const outputFile = path.join(tempDir, "owner-discovery-test.cjs");

try {
  await build({
    entryPoints: [path.resolve("scripts/test-owner-discovery.ts")],
    outfile: outputFile,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
  });
  await import(pathToFileURL(outputFile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempDir = await mkdtemp(path.join(tmpdir(), "taste-match-"));
const outputFile = path.join(tempDir, "taste-match.mjs");

try {
  await build({
    entryPoints: [path.resolve("src/lib/taste-match.ts")],
    outfile: outputFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });

  const { calculateTasteMatch } = await import(pathToFileURL(outputFile).href);
  const fheed = {
    categories: ["Fashion", "Travel", "Places", "DailyRoutine"],
    tasteTags: ["quiet-luxury", "tailoring", "slow-travel", "city-guides", "hidden-gems", "morning-rituals", "weekly-reset"],
  };

  assert.deepEqual(calculateTasteMatch(null, fheed, false), {
    state: "signed_out",
    score: null,
    sharedTastes: [],
    explanation: "Sign in to discover your Taste Match.",
    explanationAr: "سجّل الدخول لاكتشاف تطابق ذوقك.",
  });

  assert.equal(calculateTasteMatch(null, fheed, true).state, "incomplete");
  assert.equal(calculateTasteMatch({ categories: ["Fashion"], tags: ["quiet-luxury"] }, fheed, true).state, "incomplete");

  const matchingSelection = { categories: ["Fashion"], tags: ["quiet-luxury", "tailoring"] };
  const readyMatch = calculateTasteMatch(matchingSelection, fheed, true);
  assert.equal(readyMatch.state, "ready");
  assert.equal(readyMatch.score, 27);
  assert.deepEqual(readyMatch.sharedTastes.map((item) => item.id), ["quiet-luxury", "tailoring", "Fashion"]);
  assert.equal(readyMatch.explanation, "You both return to Quiet luxury and Tailoring.");

  const changedSelection = { categories: ["Restaurants"], tags: ["long-lunches", "coffee-stops"] };
  assert.equal(calculateTasteMatch(changedSelection, fheed, true).score, 0);

  console.log("Taste Match deterministic state and weighted-score tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
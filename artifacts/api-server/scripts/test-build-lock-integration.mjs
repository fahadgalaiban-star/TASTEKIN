import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const lockModule = new URL("../build-lock.mjs", import.meta.url).href;

// Import only the lock helper: never import build.mjs or any server code.
// Each isolated worker uses the real flock utility with its own descriptor.
const worker = `
  const [moduleUrl, lockPath, mode] = process.argv.slice(1);
  const { withApiBuildLock } = await import(moduleUrl);
  try {
    await withApiBuildLock(lockPath, async () => {
      process.send({ event: "acquired" });
      if (mode === "hold") {
        await new Promise(resolve => {
          const finish = () => { clearTimeout(timer); resolve(); };
          const timer = setTimeout(finish, 10000);
          process.once("message", finish);
          process.once("disconnect", finish);
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
`;

function launch(lockPath, mode) {
  const child = spawn(process.execPath,
    ["--input-type=module", "-e", worker, lockModule, lockPath, mode], {
      // No credentials or application configuration are passed to workers.
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
  const messages = [];
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", data => { stderr += data; });
  child.stdout.resume();
  let acquired;
  const ready = new Promise(resolve => { acquired = resolve; });
  child.on("message", message => {
    messages.push(message);
    if (message.event === "acquired") acquired();
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
  return { child, messages, ready, exited };
}

test("real flock rejects a second process, then permits acquisition after owner exit",
  { timeout: 20000 }, async (t) => {
    const directory = await mkdtemp("/tmp/tastekin-flock-integration-");
    const lockPath = path.join(directory, ".api-build.lock");
    const workers = [];
    t.after(async () => {
      for (const { child } of workers) {
        if (child.connected) child.send("release", () => {});
      }
      await Promise.allSettled(workers.map(worker => worker.exited));
      await rm(directory, { recursive: true, force: true });
    });

    const owner = launch(lockPath, "hold");
    workers.push(owner);
    await Promise.race([
      owner.ready,
      owner.exited.then(result => { throw new Error(`Owner exited before locking: ${result.stderr}`); }),
    ]);
    const original = await stat(lockPath);

    const contender = launch(lockPath, "once");
    workers.push(contender);
    assert.deepEqual(await contender.exited, {
      code: 1, signal: null, stderr: "API build already in progress\n",
    });
    assert.equal(contender.messages.length, 0, "contender must not enter build work");
    assert.equal(owner.child.exitCode, null, "owner must still be running");

    owner.child.send("release");
    assert.deepEqual(await owner.exited, { code: 0, signal: null, stderr: "" });

    const later = launch(lockPath, "once");
    workers.push(later);
    assert.deepEqual(await later.exited, { code: 0, signal: null, stderr: "" });
    assert.deepEqual(later.messages, [{ event: "acquired" }]);
    const remaining = await stat(lockPath);
    assert.equal(remaining.ino, original.ino, "handoff must reuse the same lock-file inode");
    assert.equal(remaining.dev, original.dev);
  });

import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdtemp, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { withApiBuildLock } from "../build-lock.mjs";

// Model kernel ownership by inode/open descriptor, using real temporary files.
// No subprocess, API build, server, database, or real flock is invoked.
function mockKernel() {
  const descriptors = new Map();
  const owners = new Map();
  const calls = [];
  let closed = 0;
  return {
    owners,
    calls,
    get closed() { return closed; },
    async openFile(...args) {
      const handle = await open(...args);
      const metadata = await handle.stat();
      const inode = `${metadata.dev}:${metadata.ino}`;
      descriptors.set(handle.fd, inode);
      return {
        fd: handle.fd,
        stat: () => handle.stat(),
        async close() {
          if (owners.get(inode) === handle.fd) owners.delete(inode);
          descriptors.delete(handle.fd);
          closed += 1;
          await handle.close();
        },
      };
    },
    runFlock(command, args, options) {
      calls.push({ command, args, options });
      const fd = options.stdio[3];
      const inode = descriptors.get(fd);
      assert.ok(inode, "flock must receive this process's open descriptor");
      if (owners.has(inode)) return { status: 73 };
      owners.set(inode, fd);
      return { status: 0 };
    },
  };
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tastekin-build-lock-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { lockPath: path.join(dir, ".api-build.lock"), kernel: mockKernel() };
}

test("contention refuses before build work and does not release the owner's lock", async (t) => {
  const { lockPath, kernel } = await fixture(t);
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const owner = withApiBuildLock(lockPath, async () => { enter(); await gate; }, kernel);
  await entered;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(
        withApiBuildLock(lockPath, () => assert.fail("contender must not build"), kernel),
        { message: "API build already in progress" },
      );
      assert.equal(kernel.owners.size, 1, "loser's close must leave owner locked");
    }
  } finally {
    release();
    await owner;
  }
  assert.equal(kernel.owners.size, 0);
  assert.equal(kernel.closed, 3);
});

test("successful work releases the lock and preserves the result", async (t) => {
  const { lockPath, kernel } = await fixture(t);
  assert.equal(await withApiBuildLock(lockPath, () => 42, kernel), 42);
  assert.equal(kernel.owners.size, 0);
  assert.equal(await withApiBuildLock(lockPath, () => "next build", kernel), "next build");
  assert.equal(kernel.closed, 2);
});

test("failed compilation releases the lock and preserves the error", async (t) => {
  const { lockPath, kernel } = await fixture(t);
  const error = new Error("mock compilation failed");
  await assert.rejects(
    withApiBuildLock(lockPath, async () => { throw error; }, kernel),
    actual => actual === error,
  );
  assert.equal(kernel.owners.size, 0);
  await withApiBuildLock(lockPath, () => undefined, kernel);
  assert.equal(kernel.closed, 2);
});

test("leftover lock files are reusable without PID checks, timeouts or inode replacement", async (t) => {
  const { lockPath, kernel } = await fixture(t);
  await writeFile(lockPath, "leftover file from a crashed build", { mode: 0o600 });
  const before = await stat(lockPath);
  await withApiBuildLock(lockPath, () => undefined, kernel);
  const after = await stat(lockPath);
  assert.equal(after.ino, before.ino);
  assert.equal(after.dev, before.dev);
  assert.equal(await readFile(lockPath, "utf8"), "leftover file from a crashed build");
  assert.equal(kernel.owners.size, 0);
});

test("requests an exclusive nonblocking lock on inherited descriptor 3", async (t) => {
  const { lockPath, kernel } = await fixture(t);
  await withApiBuildLock(lockPath, () => undefined, kernel);
  assert.equal(kernel.calls[0].command, "flock");
  assert.deepEqual(kernel.calls[0].args,
    ["--exclusive", "--nonblock", "--conflict-exit-code", "73", "3"]);
  assert.deepEqual(kernel.calls[0].options.stdio.slice(0, 3), ["ignore", "pipe", "pipe"]);
  assert.equal(typeof kernel.calls[0].options.stdio[3], "number");
  assert.equal((await stat(lockPath)).mode & 0o777, 0o600);
});

for (const result of [
  { error: Object.assign(new Error("missing utility"), { code: "ENOENT" }), status: null },
  { status: 1 },
  { status: null, signal: "SIGTERM" },
]) {
  test(`unavailable/failed flock fails closed and closes its descriptor (${result.status}/${result.signal ?? "no signal"})`, async (t) => {
    const { lockPath, kernel } = await fixture(t);
    await assert.rejects(
      withApiBuildLock(lockPath, () => assert.fail("must not build"), {
        openFile: kernel.openFile,
        runFlock: () => result,
      }),
      /API build lock unavailable/,
    );
    assert.equal(kernel.closed, 1);
    assert.equal(kernel.owners.size, 0);
  });
}

test("a thrown utility error releases the descriptor without starting work", async (t) => {
  const { lockPath, kernel } = await fixture(t);
  await assert.rejects(withApiBuildLock(lockPath, () => assert.fail("must not build"), {
    openFile: kernel.openFile,
    runFlock: () => { throw new Error("mock execution failure"); },
  }), /API build lock unavailable/);
  assert.equal(kernel.closed, 1);
});

test("symbolic-link lock paths are rejected before work or flock", async (t) => {
  const { lockPath, kernel } = await fixture(t);
  const target = `${lockPath}.target`;
  await writeFile(target, "untouched");
  await symlink(target, lockPath);
  await assert.rejects(
    withApiBuildLock(lockPath, () => assert.fail("must not build"), kernel),
    { code: "ELOOP" },
  );
  assert.equal(kernel.calls.length, 0);
  assert.equal(await readFile(target, "utf8"), "untouched");
});

test("build entry point acquires its lock outside dist before invoking the existing build", async () => {
  const source = await readFile(new URL("../build.mjs", import.meta.url), "utf8");
  assert.match(source, /withApiBuildLock\(path\.join\(artifactDir, "\.api-build\.lock"\), buildAll\)/);
  assert.equal((source.match(/buildAll\(\)/g) ?? []).length, 1, "no unguarded buildAll call");
  assert.match(source, /await rm\(distDir, \{ recursive: true, force: true \}\)/);
  assert.ok(constants.O_NOFOLLOW);
});

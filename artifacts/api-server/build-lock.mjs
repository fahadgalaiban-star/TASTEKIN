import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";

const CONFLICT_EXIT_CODE = 73;

/**
 * Serialize builds using a kernel-held flock, not a PID/timeout lock.
 * The flock utility receives a duplicate of our open file description at
 * descriptor 3. Its successful lock remains held by our descriptor after
 * the utility exits, until we close it (or the OS closes it on process death).
 *
 * Never unlink this persistent file: replacing its inode could let two
 * processes acquire independent locks for the same build destination.
 * Dependencies are injectable so tests never launch the utility or a build.
 */
export async function withApiBuildLock(
  lockPath,
  build,
  { openFile = open, runFlock = spawnSync } = {},
) {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new Error("API build lock unavailable: this platform is unsupported");
  }

  const handle = await openFile(
    lockPath,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error("API build lock unavailable: lock path must be a regular file");
    }
    let result;
    try {
      result = runFlock(
        "flock",
        ["--exclusive", "--nonblock", "--conflict-exit-code", String(CONFLICT_EXIT_CODE), "3"],
        { stdio: ["ignore", "pipe", "pipe", handle.fd] },
      );
    } catch {
      throw new Error("API build lock unavailable: flock could not be executed");
    }
    if (result.error || result.signal || result.status === null) {
      throw new Error("API build lock unavailable: flock must complete successfully");
    }
    if (result.status === CONFLICT_EXIT_CODE) {
      throw new Error("API build already in progress");
    }
    if (result.status !== 0) {
      throw new Error("API build lock unavailable: flock could not acquire the lock");
    }
    return await build();
  } finally {
    // Close only our descriptor. A contender's close cannot unlock the owner.
    await handle.close();
  }
}

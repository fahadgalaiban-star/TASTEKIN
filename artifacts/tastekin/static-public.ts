import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

/** Stage only ungated UI assets. Content media must never enter the static artifact. */
export async function prepareStaticPublic(source: string, destination: string): Promise<string> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source)) {
    if (entry === "tastekin-media") continue;
    await cp(path.join(source, entry), path.join(destination, entry), { recursive: true });
  }
  return destination;
}
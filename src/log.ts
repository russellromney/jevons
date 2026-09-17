import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";

let queue: string[] = [];
let flushing = false;
let path: string | null = null;

async function ensure() {
  if (path) return;
  await mkdir(config.dataDir, { recursive: true });
  path = join(config.dataDir, "events.jsonl");
}

async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  try {
    await ensure();
    const chunk = queue.join("");
    queue = [];
    await appendFile(path!, chunk);
  } catch {
    // drop on disk error; never block the loop
  } finally {
    flushing = false;
    if (queue.length) void flush();
  }
}

export function logEvent(row: unknown) {
  queue.push(JSON.stringify(row) + "\n");
  if (queue.length === 1) void flush();
}

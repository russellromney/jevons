import { mkdir, appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import type { DirectionalEvent } from "./directional/types";

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

/** Directional replay uses complete normalized events, not hot-loop diagnostics. */
export function logDirectional(row: unknown) {
  logEvent({ kind: "directional", row });
}

/** Load recent complete directional events from the mounted append-only log. */
export async function readDirectionalHistory(limit: number): Promise<DirectionalEvent[]> {
  try {
    const raw = await readFile(join(config.dataDir, "events.jsonl"), "utf8");
    const rows: DirectionalEvent[] = [];
    for (const line of raw.split("\n")) {
      try {
        const parsed = JSON.parse(line) as { kind?: string; row?: DirectionalEvent };
        const event = parsed.kind === "directional" ? parsed.row : null;
        // Older maker-era and pre-ledger events cannot restore a paper account.
        if (event && event.portfolio && event.execution && typeof event.ts === "number") rows.push(event);
      } catch { /* A trailing partial line is harmless after a restart. */ }
    }
    return rows.slice(-limit);
  } catch {
    return [];
  }
}

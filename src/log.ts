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

/** Load block history and a separate execution tape from the append-only log. */
export async function readDirectionalState(historyLimit: number, executionLimit = 100): Promise<{ history: DirectionalEvent[]; executions: DirectionalEvent[] }> {
  try {
    const raw = await readFile(join(config.dataDir, "events.jsonl"), "utf8");
    const history: DirectionalEvent[] = [];
    const executions: DirectionalEvent[] = [];
    let llmCalls = 0;
    for (const line of raw.split("\n")) {
      try {
        const parsed = JSON.parse(line) as { kind?: string; row?: DirectionalEvent };
        const event = parsed.kind === "directional" ? parsed.row : null;
        // Older maker-era and pre-ledger events cannot restore a paper account.
        if (event && event.portfolio && event.execution && typeof event.ts === "number") {
          if (event.decision?.jev?.used) llmCalls++;
          history.push(event);
          if (history.length > historyLimit) history.shift();
          if (event.execution.status === "opened" || event.execution.status === "closed") {
            executions.push(event);
            if (executions.length > executionLimit) executions.shift();
          }
        }
      } catch { /* A trailing partial line is harmless after a restart. */ }
    }
    // Backfill the cumulative counter for logs written before totals.llmCalls existed.
    if (history.length) history.at(-1)!.totals.llmCalls = llmCalls;
    return { history, executions };
  } catch {
    return { history: [], executions: [] };
  }
}

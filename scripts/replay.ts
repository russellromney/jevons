import { readFile } from "node:fs/promises";
import { PaperExecutor } from "../src/directional/paper";
import type { Book } from "../src/book";
import type { DirectionalEvent } from "../src/directional/types";

const path = process.argv[2] ?? "data/events.jsonl";
const strategy = process.argv[3];
const rows = (await readFile(path, "utf8")).trim().split("\n").flatMap((line) => {
  try {
    const parsed = JSON.parse(line) as { kind?: string; row?: DirectionalEvent };
    return parsed.kind === "directional" && parsed.row ? [parsed.row] : [];
  } catch { return []; }
}).filter((event) => !strategy || event.strategy === strategy).sort((a, b) => a.block - b.block);

if (!rows.length) throw new Error(`no directional events in ${path}${strategy ? ` for ${strategy}` : ""}`);
const baseline = new PaperExecutor();
const replayBook = (event: DirectionalEvent): Book => ({
  block: event.block, bid: event.bestBid, ask: event.bestAsk, mid: event.mid, microprice: event.mid, spreadBps: event.spreadBps,
  // Historical directional events predate level snapshots. The replay assumes
  // the displayed touch can fill the configured paper size; live execution uses
  // actual L2 VWAP and rejects insufficient depth.
  bidSize: 1e9, askSize: 1e9,
  levels: { bids: [[event.bestBid, 1e9]], asks: [[event.bestAsk, 1e9]] },
  depthBps: { "10": { bid: 1e9, ask: 1e9 } }, imbalance: 0,
});
for (const event of rows) {
  const book = replayBook(event);
  baseline.update(event.block, book);
  if (baseline.position(event.mid).side === "flat" && event.decision.candidate) {
    baseline.consider(event.block, book, event.decision.candidate, true, "deterministic baseline");
  }
  baseline.update(event.block, book, false);
}
const actual = rows.at(-1)!.totals;
const gated = rows.filter((event) => event.decision.jev?.used).length;
const rejected = rows.filter((event) => event.decision.candidate && event.decision.jev && !event.decision.jev.accepted).length;
console.log(JSON.stringify({
  events: rows.length, strategy: strategy ?? "all", actual: { trades: actual.opened + actual.closed, pnlUsd: actual.pnlUsd, maxDrawdownUsd: actual.maxDrawdownUsd, wins: actual.wins, losses: actual.losses },
  deterministicBaseline: { trades: baseline.totals.opened + baseline.totals.closed, pnlUsd: baseline.totals.pnlUsd, maxDrawdownUsd: baseline.totals.maxDrawdownUsd, wins: baseline.totals.wins, losses: baseline.totals.losses },
  jev: { evaluatedCandidates: gated, rejectedCandidates: rejected },
}, null, 2));

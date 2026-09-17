import { describe, expect, test } from "bun:test";
import type { BlockEvent } from "./types";

const event: BlockEvent = {
  block: 1, ts: 1, mid: 0.0225, bestBid: 0.022496, bestAsk: 0.022504, spreadBps: 3.56, microprice: 0.0225,
  decision: {
    posture: "sit", late: false, probabilities: { both: 0.7, sit: 0.3 },
    sensors: { toxic: 0.1, stale: 0.05, hold: 0.8, widthTicks: 0, sizeMult: 1, regime: "quiet", latencyMs: 0, skipped: true },
  },
  quote: {
    bid: { price: 0.022496, size: 200 }, ask: { price: 0.022504, size: 200 },
    txHash: null, gasMon: 0, cancel: [], status: "resting", sent: false, orderIdBid: -1, orderIdAsk: -2,
  },
  fill: null,
  resting: { bidMon: 200, askMon: 200 },
  position: { side: "flat", size: 0, entryPrice: null, unrealizedUsd: 0, unrealizedMon: 0 },
  totals: {
    blocks: 10, decisions: 10, quotes: 1, sits: 9, pulls: 0, fills: 0, reverted: 0, lateBlocks: 0,
    modelUsd: 0, gasMon: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlMon: 0, pnlPct: 0,
    fillRate: 0, markout10Bps: null, postureAutocorr: 0.9,
  },
};

describe("schema", () => {
  test("round-trip keeps quote and fills", () => {
    const raw = JSON.parse(JSON.stringify(event)) as BlockEvent;
    expect(raw.quote.status).toBe("resting");
    expect(raw.quote.sent).toBe(false);
    expect(raw.totals.fills).toBe(0);
    expect(raw.totals.sits).toBe(9);
    expect(raw.decision.late).toBe(false);
    expect(raw.decision.posture).toBe("sit");
  });
});

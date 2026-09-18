import { describe, expect, test } from "bun:test";
import type { Book } from "../book";
import type { Features } from "../features";
import { applyGateConviction, evaluateStrategy } from "./engines";
import { PaperExecutor } from "./paper";
import type { DirectionalEvent, FeedHealth } from "./types";

const book: Book = {
  block: 1, bid: 100, ask: 100.1, mid: 100.05, microprice: 100.05, spreadBps: 10,
  bidSize: 1000, askSize: 1000, imbalance: 0,
  levels: { bids: [[100, 1000]], asks: [[100.1, 1000]] }, depthBps: { "10": { bid: 1000, ask: 1000 } },
};
const features: Features = { mid: 100.05, microprice: 100.05, spreadBps: 10, imbalance: 0, sigma: 0,
  ret1: 0, ret5: 0, ret20: 0, ret100: 0, cvdMon: 0, lastSide: null, queueBid: 1000, queueAsk: 1000, q: 0, basisBps: 0, medianSpreadBps: 10 };
const health: FeedHealth = { kuru: "live", reference: "live", liquidation: "missing", funding: "live", events: "missing" };

describe("directional engines", () => {
  test("does not call ordinary flow a liquidation", () => {
    const out = evaluateStrategy("liquidation", { block: 1, book, features, reference: null, health });
    expect(out.candidate).toBeNull();
    expect(out.holdReason).toContain("liquidation feed unavailable");
  });

  test("CEX lag requires an unabsorbed reference move that clears costs", () => {
    const out = evaluateStrategy("cex_lag", { block: 1, book, features, health,
      reference: { source: "test", bid: 100.7, ask: 100.9, mid: 100.8, fundingRate: 0, ret1Bps: 18, updatedAt: Date.now() } });
    expect(out.candidate?.action).toBe("buy");
    expect(out.candidate?.expectedEdgeBps).toBeGreaterThan(0);
    expect(out.candidate?.horizonBlocks).toBe(200);
  });

  test("sizes stronger edges larger and lets Jev conviction amplify them", () => {
    const deepBook: Book = { ...book, levels: { bids: [[100, 1_000_000]], asks: [[100.1, 1_000_000]] } };
    const weak = evaluateStrategy("cex_lag", { block: 1, book: deepBook, features, health, equityUsd: 100_000,
      reference: { source: "test", bid: 100.7, ask: 100.9, mid: 100.8, fundingRate: 0, ret1Bps: 15, updatedAt: Date.now() } });
    const strong = evaluateStrategy("cex_lag", { block: 1, book: deepBook, features, health, equityUsd: 100_000,
      reference: { source: "test", bid: 100.7, ask: 100.9, mid: 100.8, fundingRate: 0, ret1Bps: 18, updatedAt: Date.now() } });
    expect(weak.candidate?.sizeMon).toBeGreaterThanOrEqual(500);
    expect(strong.candidate!.sizeMon).toBeGreaterThan(weak.candidate!.sizeMon);
    const amplified = applyGateConviction("cex_lag", strong.candidate!, {
      used: true, accepted: true, continuation: 1, exhaustion: 0, forcedFlow: 0,
      transientShock: 0, eventMaterial: 0, reason: "strong", latencyMs: 1,
    }, deepBook);
    expect(amplified.sizeMon).toBeGreaterThan(strong.candidate!.sizeMon);
    expect(amplified.sizeMon).toBeLessThanOrEqual(250_000);
  });

  test("CEX lag does not use a static venue-price level as a directional edge", () => {
    const out = evaluateStrategy("cex_lag", { block: 1, book, health,
      features: { ...features, ret5: 7.9 },
      reference: { source: "test", bid: 100.7, ask: 100.9, mid: 100.8, fundingRate: 0, ret1Bps: 8, updatedAt: Date.now() } });
    expect(out.candidate).toBeNull();
    expect(out.holdReason).toContain("unabsorbed move");
  });
});

describe("directional paper execution", () => {
  test("opens at the executable ask and exits at expiry", () => {
    const paper = new PaperExecutor();
    const candidate = { action: "buy" as const, sizeMon: 150, reason: "test", expectedEdgeBps: 20, horizonBlocks: 1, stopBps: 100, takeProfitBps: 100, hedged: false, requiredFeeds: ["kuru"] as ("kuru")[] };
    const opened = paper.consider(10, book, candidate, true, "");
    expect(opened.status).toBe("opened");
    expect(opened.price).toBe(100.1);
    expect(paper.portfolio(100.05)).toMatchObject({ mon: 150, cashUsd: -14915, equityUsd: 92.5 });
    const closed = paper.update(11, { ...book, mid: 100.3, bid: 100.25, ask: 100.35 });
    expect(closed?.status).toBe("closed");
    expect(paper.position(100.3).side).toBe("flat");
    expect(paper.portfolio(100.3)).toMatchObject({ mon: 0, cashUsd: 85, equityUsd: 85 });

    const restored = new PaperExecutor();
    restored.restore({
      position: paper.position(100.3), portfolio: paper.portfolio(100.3), totals: { ...paper.totals },
    } as DirectionalEvent);
    expect(restored.portfolio(100.3)).toMatchObject({ mon: 0, cashUsd: 85, equityUsd: 85 });
    expect(restored.totals.closed).toBe(1);
  });

  test("rejects a paper entry when displayed L2 cannot fill the configured size", () => {
    const paper = new PaperExecutor();
    const candidate = { action: "buy" as const, sizeMon: 100, reason: "test", expectedEdgeBps: 20, horizonBlocks: 1, stopBps: 100, takeProfitBps: 100, hedged: false, requiredFeeds: ["kuru"] as ("kuru")[] };
    const shallow: Book = { ...book, levels: { bids: [[100, 99]], asks: [[100.1, 99]] } };
    const result = paper.consider(10, shallow, candidate, true, "");
    expect(result.status).toBe("rejected");
    expect(result.note).toContain("insufficient displayed depth");
  });

  test("marks short proceeds and the MON liability into net equity", () => {
    const paper = new PaperExecutor();
    const candidate = { action: "sell" as const, sizeMon: 500, reason: "test", expectedEdgeBps: 20, horizonBlocks: 1, stopBps: 100, takeProfitBps: 100, hedged: false, requiredFeeds: ["kuru"] as ("kuru")[] };
    paper.consider(10, book, candidate, true, "");
    expect(paper.portfolio(100.05)).toMatchObject({ cashUsd: 50_100, mon: -500, positionValueUsd: -50_025, equityUsd: 75 });
    paper.update(11, book);
    expect(paper.portfolio(100.05)).toMatchObject({ cashUsd: 50, mon: 0, positionValueUsd: 0, equityUsd: 50 });
  });

  test("trails a profitable move instead of waiting for maximum holding time", () => {
    const paper = new PaperExecutor();
    const candidate = { action: "buy" as const, sizeMon: 150, reason: "test", expectedEdgeBps: 20, horizonBlocks: 200, stopBps: 100, takeProfitBps: 100, hedged: false, requiredFeeds: ["kuru"] as ("kuru")[] };
    paper.consider(10, book, candidate, true, "");
    const advance: Book = { ...book, bid: 100.29, ask: 100.31, mid: 100.3, levels: { bids: [[100.29, 1000]], asks: [[100.31, 1000]] } };
    expect(paper.update(11, advance)).toBeNull();
    const pullback: Book = { ...book, bid: 100.22, ask: 100.24, mid: 100.23, levels: { bids: [[100.22, 1000]], asks: [[100.24, 1000]] } };
    const closed = paper.update(12, pullback);
    expect(closed?.status).toBe("closed");
    expect(closed?.note).toBe("trailing profit");
    expect(closed?.realizedPnlUsd).toBeGreaterThan(0);
  });
});

test("directional wire event round-trips without maker fields", () => {
  const event: DirectionalEvent = {
    block: 1, ts: 1, strategy: "cex_lag", mid: 100.05, bestBid: 100, bestAsk: 100.1, spreadBps: 10,
    reference: null, feedHealth: { kuru: "live", reference: "missing", liquidation: "missing", funding: "missing", events: "missing" },
    signals: { basisBps: null, referenceReturnBps: null, kuruReturnBps: 0, entryCostBps: 0, roundTripCostBps: 0, residualBps: null },
    decision: { strategy: "cex_lag", action: "hold", reason: "reference unavailable", candidate: null, jev: null, late: false },
    execution: { status: "held", action: "hold", price: null, size: 0, feeUsd: 0, slippageBps: 0, notionalUsd: 0, realizedPnlUsd: null, simulated: true, note: "reference unavailable" },
    position: { side: "flat", size: 0, entryPrice: null, openedBlock: null, expiryBlock: null, stopPrice: null, takeProfitPrice: null, unrealizedUsd: 0 },
    portfolio: { startingCapitalUsd: 100, cashUsd: 100, mon: 0, markPrice: 100.05, positionValueUsd: 0, equityUsd: 100 },
    totals: { blocks: 1, decisions: 1, holds: 1, buys: 0, sells: 0, opened: 0, closed: 0, wins: 0, losses: 0, llmCalls: 0, realizedUsd: 0, unrealizedUsd: 0, feesUsd: 0, pnlUsd: 0, pnlPct: 0, maxDrawdownUsd: 0, modelUsd: 0 },
  };
  const raw = JSON.parse(JSON.stringify(event));
  expect(raw.execution.simulated).toBe(true);
  expect(raw.quote).toBeUndefined();
  expect(raw.decision.action).toBe("hold");
});

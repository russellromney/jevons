import { describe, expect, test } from "bun:test";
import { decidePolicy, simFill, type PolicyInput } from "./policy";
import type { Book } from "./book";
import type { Features } from "./features";
import type { Answers } from "./model";

const book: Book = {
  block: 1, bid: 0.022496, ask: 0.022504, mid: 0.0225, microprice: 0.0225,
  spreadBps: 3.56, bidSize: 1000, askSize: 1000, imbalance: 0,
  levels: { bids: [[0.022496, 1000]], asks: [[0.022504, 1000]] },
  depthBps: { "10": { bid: 1000, ask: 1000 }, "25": { bid: 2000, ask: 2000 } },
};

const feat = (q = 0): Features => ({
  mid: book.mid, microprice: book.microprice, spreadBps: book.spreadBps, imbalance: 0,
  sigma: 0.00005, ret1: 0, ret5: 0, ret20: 0, ret100: 0, cvdMon: 0, lastSide: null,
  queueBid: 1000, queueAsk: 1000, q, basisBps: null, medianSpreadBps: 4,
});

const answers = (over: Partial<Answers> = {}): Answers => ({
  toxic: 0.1, stale: 0.05, hold: 0.2, posture: "both", widthTicks: 0, sizeMult: 1,
  regime: "quiet", probabilities: { both: 1 }, latencyMs: 0, inputTokens: 0, skipped: false,
  ...over,
});

const base = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  book, feat: feat(), answers: answers(), q: 0,
  resting: { bid: null, ask: null, ageBlocks: 0 },
  touchUnchanged: false, late: false, paused: false,
  priceDec: 8, tickUnits: 100, dryRun: true, gasUsd: 0,
  ...over,
});

describe("policy", () => {
  test("toxic pulls", () => {
    const d = decidePolicy(base({
      answers: answers({ toxic: 0.8, posture: "both" }),
      resting: { bid: { price: 0.022496, size: 200 }, ask: { price: 0.022504, size: 200 }, ageBlocks: 3 },
    }));
    expect(d.posture).toBe("pull");
    expect(d.pull).toBe(true);
    expect(d.send).toBe(true);
    expect(d.bid).toBeNull();
    expect(d.ask).toBeNull();
  });

  test("hold + same touch sits", () => {
    const first = decidePolicy(base({ answers: answers({ hold: 0.2, posture: "both" }) }));
    const rest = { bid: first.bid, ask: first.ask, ageBlocks: 4 };
    const d = decidePolicy(base({
      answers: answers({ hold: 0.9, posture: "both" }),
      resting: rest,
      touchUnchanged: true,
    }));
    expect(d.posture).toBe("sit");
    expect(d.send).toBe(false);
  });

  test("late keeps resting and does not send", () => {
    const rest = { bid: { price: 0.022496, size: 200 }, ask: { price: 0.022504, size: 200 }, ageBlocks: 1 };
    const d = decidePolicy(base({ late: true, resting: rest }));
    expect(d.posture).toBe("late");
    expect(d.send).toBe(false);
    expect(d.bid).toEqual(rest.bid);
  });

  test("cap flattens the adding side, does not invert", () => {
    const d = decidePolicy(base({
      q: 900,
      feat: feat(900),
      answers: answers({ posture: "both" }),
    }));
    expect(d.posture).toBe("flatten");
    expect(d.bid).toBeNull();
    expect(d.ask).not.toBeNull();
  });

  test("never crosses the spread", () => {
    const d = decidePolicy(base({ answers: answers({ widthTicks: 0, posture: "both" }) }));
    if (d.bid && d.ask) {
      expect(d.bid.price).toBeLessThan(book.ask);
      expect(d.ask.price).toBeGreaterThan(book.bid);
      expect(d.bid.price).toBeLessThan(d.ask.price);
    }
  });
});

describe("sim fills", () => {
  const rest = { bid: { price: 0.022496, size: 200 }, ask: { price: 0.022504, size: 200 }, ageBlocks: 1 };
  test("touch is not a fill", () => {
    expect(simFill({ side: "sell", price: 0.022496, size: 50 }, rest)).toBeNull();
    expect(simFill({ side: "buy", price: 0.022504, size: 50 }, rest)).toBeNull();
  });
  test("through is a fill", () => {
    const bidHit = simFill({ side: "sell", price: 0.022490, size: 50 }, rest);
    expect(bidHit?.side).toBe("buy");
    expect(bidHit?.size).toBe(50);
    const askHit = simFill({ side: "buy", price: 0.022510, size: 80 }, rest);
    expect(askHit?.side).toBe("sell");
  });
});

import type { Book } from "./book";
import type { Features } from "./features";
import type { Answers } from "./model";
import type { Posture } from "./types";
import { config } from "./config";

export interface Desired {
  posture: Posture;
  bid: { price: number; size: number } | null;
  ask: { price: number; size: number } | null;
  send: boolean;
  pull: boolean;
}

export interface RestingSnap {
  bid: { price: number; size: number } | null;
  ask: { price: number; size: number } | null;
  ageBlocks: number;
}

export interface PolicyInput {
  book: Book;
  feat: Features;
  answers: Answers;
  q: number;
  resting: RestingSnap;
  touchUnchanged: boolean;
  late: boolean;
  paused: boolean;
  priceDec: number;
  tickUnits: number;
  dryRun: boolean;
  gasUsd: number;
}

function clip(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function floorTick(p: number, scale: number, tick: number) {
  const u = Math.round(p * scale);
  return (Math.floor(u / tick) * tick) / scale;
}

function ceilTick(p: number, scale: number, tick: number) {
  const u = Math.round(p * scale);
  return (Math.ceil(u / tick) * tick) / scale;
}

export function reservation(feat: Features): { r: number; half: number } {
  const s = feat.microprice;
  const qn = config.maxPositionMon > 0 ? feat.q / config.maxPositionMon : 0;
  const sigma2 = feat.sigma * feat.sigma;
  const g = config.gamma;
  const k = config.kappa;
  const t = config.horizonSec;
  const r = s - qn * g * sigma2 * t * s;
  let halfFrac = 0.5 * (g * sigma2 * t + (2 / g) * Math.log(1 + g / k));
  if (!Number.isFinite(halfFrac) || halfFrac < 0) halfFrac = 0;
  let half = halfFrac * s;
  const tickPx = 1e-6; // MON-USDC tick; refined by caller via tickUnits/scale
  const minH = config.minHalfTicks * tickPx;
  const maxH = config.maxHalfTicks * tickPx;
  if (!(half > 0)) half = Math.max(minH, 0.3 * (feat.spreadBps / 10_000) * s);
  half = clip(half, minH, maxH);
  return { r, half };
}

function sizeFor(mult: number): number {
  if (mult <= 0) return 0;
  return config.tradeSizeMon * (mult === 0.5 ? 0.5 : mult >= 2 ? 2 : 1);
}

function sameLevel(a: { price: number; size: number } | null, b: { price: number; size: number } | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a.price - b.price) < 1e-12 && Math.abs(a.size - b.size) < 1e-9;
}

export function decidePolicy(input: PolicyInput): Desired {
  const { book, feat, answers, q, resting, touchUnchanged, late, paused, priceDec, tickUnits, dryRun, gasUsd } = input;
  const scale = 10 ** priceDec;
  const tick = tickUnits;
  const tickPx = tick / scale;
  const empty: Desired = { posture: "sit", bid: resting.bid, ask: resting.ask, send: false, pull: false };

  if (late || paused) {
    return { ...empty, posture: late ? "late" : "sit" };
  }

  let posture: Posture = answers.posture;
  // Noul is a calibrated P(true) but does not return a separate confidence field.
  if (answers.toxic > config.toxicTau && (answers.confidence.toxic ?? 1) >= 0.5) posture = "pull";
  if (answers.stale > config.staleTau && feat.basisBps != null && Math.abs(feat.basisBps) * book.mid / 10_000 > 2 * tickPx) {
    posture = feat.basisBps > 0 ? "bid_only" : "ask_only";
  }
  const absQ = Math.abs(q);
  if (absQ >= config.maxPositionMon * 0.8 || posture === "flatten") {
    posture = "flatten";
  }

  if (posture === "pull") {
    const had = !!(resting.bid || resting.ask);
    return { posture: "pull", bid: null, ask: null, send: had, pull: true };
  }

  const { r, half: half0 } = reservation(feat);
  const half = half0 + answers.widthTicks * tickPx;
  let bidPx = floorTick(r - half, scale, tick);
  let askPx = ceilTick(r + half, scale, tick);
  if (bidPx >= book.ask) bidPx = book.bid;
  if (askPx <= book.bid) askPx = book.ask;
  if (bidPx >= askPx) {
    bidPx = book.bid;
    askPx = book.ask;
  }

  let size = sizeFor(answers.sizeMult);
  if (size < config.tradeSizeMon && answers.sizeMult > 0) size = config.tradeSizeMon;
  if (answers.sizeMult <= 0) size = 0;

  let bid: Desired["bid"] = { price: bidPx, size };
  let ask: Desired["ask"] = { price: askPx, size };

  if (posture === "flatten") {
    if (q > 0) bid = null;
    else if (q < 0) ask = null;
    else {
      bid = null;
      ask = null;
    }
  } else if (posture === "bid_only") ask = null;
  else if (posture === "ask_only") bid = null;

  // Cap: never add to a maxed side.
  if (q + (bid?.size ?? 0) > config.maxPositionMon) bid = null;
  if (-q + (ask?.size ?? 0) > config.maxPositionMon) ask = null;

  if (!bid && !ask) {
    const had = !!(resting.bid || resting.ask);
    return { posture: "flatten", bid: null, ask: null, send: had, pull: had };
  }

  if (answers.hold > config.holdTau && touchUnchanged && posture !== "flatten") {
    if (sameLevel(bid, resting.bid) && sameLevel(ask, resting.ask)) {
      return { posture: "sit", bid: resting.bid, ask: resting.ask, send: false, pull: false };
    }
  }

  if (!dryRun && gasUsd > 0 && size > 0) {
    const ev = (half / book.mid) * size * book.mid; // ~ half-spread * size in USD
    if (ev < gasUsd) {
      return { posture: "sit", bid: resting.bid, ask: resting.ask, send: false, pull: false };
    }
  }

  const changed = !sameLevel(bid, resting.bid) || !sameLevel(ask, resting.ask);
  if (!changed) {
    return { posture: "sit", bid: resting.bid, ask: resting.ask, send: false, pull: false };
  }

  return { posture, bid, ask, send: true, pull: false };
}

/** Dry-run fill: strict through-price. Touch is not a fill. */
export function simFill(
  print: { side: "buy" | "sell"; price: number; size: number },
  resting: RestingSnap,
): { side: "buy" | "sell"; price: number; size: number } | null {
  if (print.side === "sell" && resting.bid && print.price < resting.bid.price) {
    return { side: "buy", price: resting.bid.price, size: Math.min(print.size, resting.bid.size) };
  }
  if (print.side === "buy" && resting.ask && print.price > resting.ask.price) {
    return { side: "sell", price: resting.ask.price, size: Math.min(print.size, resting.ask.size) };
  }
  return null;
}

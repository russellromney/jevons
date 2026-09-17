import type { Book } from "./book";
import type { TradeSummary } from "./trades";
import { config } from "./config";

export interface Features {
  mid: number;
  microprice: number;
  spreadBps: number;
  imbalance: number;
  sigma: number; // per-block stdev of fractional mid returns
  ret1: number;
  ret5: number;
  ret20: number;
  ret100: number;
  cvdMon: number;
  lastSide: "buy" | "sell" | null;
  queueBid: number;
  queueAsk: number;
  q: number;
  basisBps: number | null;
  medianSpreadBps: number;
}

const bps = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / b) * 10_000);

export class MidRing {
  private mids: number[] = [];
  private spreads: number[] = [];
  push(mid: number, spreadBps: number) {
    this.mids.push(mid);
    this.spreads.push(spreadBps);
    const cap = Math.max(config.horizonBlocks + 5, 120);
    if (this.mids.length > cap) {
      this.mids.splice(0, this.mids.length - cap);
      this.spreads.splice(0, this.spreads.length - cap);
    }
  }
  at(n: number): number | undefined {
    return this.mids[this.mids.length - 1 - n];
  }
  sampled(step = 5): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.mids.length; i += step) out.push(this.mids[i]!);
    return out.slice(-20);
  }
  medianSpread(): number {
    if (!this.spreads.length) return 4;
    const s = [...this.spreads].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
  sigma(): number {
    if (this.mids.length < 8) return 0;
    const rets: number[] = [];
    for (let i = 1; i < this.mids.length; i++) {
      const a = this.mids[i - 1]!, b = this.mids[i]!;
      if (a > 0) rets.push((b - a) / a);
    }
    const n = rets.length;
    if (!n) return 0;
    const mu = rets.reduce((s, x) => s + x, 0) / n;
    const v = rets.reduce((s, x) => s + (x - mu) ** 2, 0) / n;
    return Math.sqrt(v);
  }
}

export function computeFeatures(book: Book, ring: MidRing, trades: TradeSummary, q: number, basisBps: number | null): Features {
  const mid = book.mid;
  const prev = (n: number) => ring.at(n) ?? mid;
  return {
    mid,
    microprice: book.microprice,
    spreadBps: book.spreadBps,
    imbalance: book.imbalance,
    sigma: ring.sigma(),
    ret1: bps(mid, prev(1)),
    ret5: bps(mid, prev(5)),
    ret20: bps(mid, prev(20)),
    ret100: bps(mid, prev(Math.min(99, config.horizonBlocks))),
    cvdMon: trades.cvdMon,
    lastSide: trades.lastSide,
    queueBid: book.bidSize,
    queueAsk: book.askSize,
    q,
    basisBps,
    medianSpreadBps: ring.medianSpread(),
  };
}

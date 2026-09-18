import { config } from "../config";
import type { Book } from "../book";
import type { Candidate, DirectionalEvent, DirectionalPortfolio, DirectionalPosition, DirectionalTotals, PaperExecution, StrategyId } from "./types";

const emptyTotals = (): DirectionalTotals => ({
  blocks: 0, decisions: 0, holds: 0, buys: 0, sells: 0, opened: 0, closed: 0, wins: 0, losses: 0,
  llmCalls: 0, realizedUsd: 0, unrealizedUsd: 0, feesUsd: 0, pnlUsd: 0, pnlPct: 0, maxDrawdownUsd: 0, modelUsd: 0,
});

export class PaperExecutor {
  private side: "long" | "short" | "flat" = "flat";
  private sizeMon = 0;
  private entry: number | null = null;
  private openedBlock: number | null = null;
  private openedAt: number | null = null;
  private maxExitAt: number | null = null;
  private thesisStrategy: StrategyId | null = null;
  private entrySignalBps: number | null = null;
  private expiryBlock: number | null = null;
  private stopPrice: number | null = null;
  private takeProfitPrice: number | null = null;
  private favorablePrice: number | null = null;
  private realizedUsd = 0;
  private feesUsd = 0;
  private cashUsd = config.bankrollUsd;
  private peakPnl = 0;
  readonly totals = emptyTotals();

  position(mid: number): DirectionalPosition {
    const sign = this.side === "long" ? 1 : this.side === "short" ? -1 : 0;
    const unrealizedUsd = this.entry == null ? 0 : sign * this.sizeMon * (mid - this.entry);
    return { side: this.side, size: this.sizeMon, entryPrice: this.entry, openedBlock: this.openedBlock,
      openedAt: this.openedAt, maxExitAt: this.maxExitAt, thesisStrategy: this.thesisStrategy, entrySignalBps: this.entrySignalBps,
      expiryBlock: this.expiryBlock, stopPrice: this.stopPrice, takeProfitPrice: this.takeProfitPrice, unrealizedUsd };
  }

  portfolio(mid: number): DirectionalPortfolio {
    const mon = this.side === "long" ? this.sizeMon : this.side === "short" ? -this.sizeMon : 0;
    const positionValueUsd = mon * mid;
    return { startingCapitalUsd: config.bankrollUsd, cashUsd: this.cashUsd, mon, markPrice: mid, positionValueUsd, equityUsd: this.cashUsd + positionValueUsd };
  }

  /** Restore the exact paper account shown in the last durable event. */
  restore(event: DirectionalEvent) {
    const p = event.position;
    this.side = p.side;
    this.sizeMon = p.size;
    this.entry = p.entryPrice;
    this.openedBlock = p.openedBlock;
    this.openedAt = p.openedAt ?? (p.side === "flat" ? null : event.ts);
    this.thesisStrategy = p.thesisStrategy ?? (p.side === "flat" ? null : event.strategy);
    this.entrySignalBps = p.entrySignalBps ?? null;
    const fallbackHold = this.thesisStrategy === "mean_reversion" ? config.meanReversionMaxHoldMs : config.cexMaxHoldMs;
    this.maxExitAt = p.maxExitAt ?? (this.openedAt == null ? null : this.openedAt + fallbackHold);
    this.expiryBlock = p.expiryBlock;
    this.stopPrice = p.stopPrice;
    this.takeProfitPrice = p.takeProfitPrice;
    this.favorablePrice = event.mid;
    this.cashUsd = event.portfolio.cashUsd;
    this.realizedUsd = event.totals.realizedUsd;
    this.feesUsd = event.totals.feesUsd;
    this.peakPnl = Math.max(event.totals.pnlUsd, event.totals.pnlUsd - event.totals.maxDrawdownUsd);
    Object.assign(this.totals, event.totals);
  }

  update(block: number, book: Book, countBlock = true, thesisExit: string | null = null, now = Date.now()) {
    if (countBlock) this.totals.blocks++;
    const p = this.position(book.mid);
    this.totals.unrealizedUsd = p.unrealizedUsd;
    this.totals.realizedUsd = this.realizedUsd;
    this.totals.feesUsd = this.feesUsd;
    this.totals.pnlUsd = this.realizedUsd + p.unrealizedUsd - this.feesUsd;
    this.totals.pnlPct = (this.totals.pnlUsd / config.bankrollUsd) * 100;
    this.peakPnl = Math.max(this.peakPnl, this.totals.pnlUsd);
    this.totals.maxDrawdownUsd = Math.min(this.totals.maxDrawdownUsd, this.totals.pnlUsd - this.peakPnl);
    if (this.side === "flat") return null;
    this.favorablePrice = this.side === "long"
      ? Math.max(this.favorablePrice ?? book.mid, book.mid)
      : Math.min(this.favorablePrice ?? book.mid, book.mid);
    const stopped = this.side === "long" ? book.mid <= (this.stopPrice ?? -Infinity) : book.mid >= (this.stopPrice ?? Infinity);
    const target = this.side === "long" ? book.mid >= (this.takeProfitPrice ?? Infinity) : book.mid <= (this.takeProfitPrice ?? -Infinity);
    const favorableBps = this.entry == null || this.favorablePrice == null ? 0 : this.side === "long"
      ? (this.favorablePrice - this.entry) / this.entry * 10_000
      : (this.entry - this.favorablePrice) / this.entry * 10_000;
    const givebackBps = this.favorablePrice == null ? 0 : this.side === "long"
      ? (this.favorablePrice - book.mid) / this.favorablePrice * 10_000
      : (book.mid - this.favorablePrice) / this.favorablePrice * 10_000;
    if (stopped) return this.close(block, book, "stop");
    if (target) return this.close(block, book, "take profit");
    if (favorableBps >= config.trailActivationBps && givebackBps >= config.trailGivebackBps) return this.close(block, book, "trailing profit");
    if (thesisExit) return this.close(block, book, thesisExit);
    if (now >= (this.maxExitAt ?? Infinity)) return this.close(block, book, "maximum wall-clock holding time");
    if (this.totals.pnlUsd <= -config.maxLossUsd) return this.close(block, book, "max loss");
    return null;
  }

  consider(block: number, book: Book, candidate: Candidate | null, accepted: boolean, reason: string, strategy: StrategyId = "cex_lag", now = Date.now()): PaperExecution {
    this.totals.decisions++;
    if (this.side !== "flat") {
      this.totals.holds++;
      return this.held("position open; only exit logic may trade");
    }
    if (!candidate) { this.totals.holds++; return this.held(reason); }
    if (!accepted) { this.totals.holds++; return { ...this.held(reason), status: "rejected" }; }
    const size = candidate.sizeMon;
    const raw = executablePrice(book, candidate.action, size);
    if (raw == null) { this.totals.holds++; return { ...this.held("insufficient displayed depth"), status: "rejected" }; }
    const px = cushion(raw, candidate.action);
    const fee = px * size * config.takerFeeBps / 10_000;
    const notionalUsd = px * size;
    this.feesUsd += fee;
    this.cashUsd += candidate.action === "buy" ? -notionalUsd - fee : notionalUsd - fee;
    this.side = candidate.action === "buy" ? "long" : "short";
    this.sizeMon = size;
    this.favorablePrice = book.mid;
    this.entry = px; this.openedBlock = block; this.openedAt = now;
    this.maxExitAt = now + (candidate.maxHoldMs ?? (strategy === "mean_reversion" ? config.meanReversionMaxHoldMs : config.cexMaxHoldMs));
    this.thesisStrategy = strategy; this.entrySignalBps = candidate.signalBps ?? null; this.expiryBlock = null;
    this.stopPrice = this.side === "long" ? px * (1 - candidate.stopBps / 10_000) : px * (1 + candidate.stopBps / 10_000);
    this.takeProfitPrice = this.side === "long" ? px * (1 + candidate.takeProfitBps / 10_000) : px * (1 - candidate.takeProfitBps / 10_000);
    this.totals.opened++; if (candidate.action === "buy") this.totals.buys++; else this.totals.sells++;
    return { status: "opened", action: candidate.action, price: px, size, feeUsd: fee, slippageBps: impactBps(book, candidate.action, raw), notionalUsd, realizedPnlUsd: null, simulated: true, note: candidate.reason };
  }

  private close(block: number, book: Book, note: string): PaperExecution {
    const action = this.side === "long" ? "sell" : "buy";
    const size = this.sizeMon;
    const raw = executablePrice(book, action, size);
    if (raw == null) return { ...this.held("insufficient displayed depth to exit"), status: "rejected" };
    const px = cushion(raw, action);
    const fee = px * size * config.takerFeeBps / 10_000;
    const notionalUsd = px * size;
    const sign = this.side === "long" ? 1 : -1;
    const pnl = sign * size * (px - (this.entry ?? px));
    this.cashUsd += action === "buy" ? -notionalUsd - fee : notionalUsd - fee;
    this.realizedUsd += pnl; this.feesUsd += fee; this.totals.closed++; if (pnl >= 0) this.totals.wins++; else this.totals.losses++;
    this.side = "flat"; this.sizeMon = 0; this.entry = null; this.openedBlock = null; this.openedAt = null; this.maxExitAt = null; this.thesisStrategy = null; this.entrySignalBps = null; this.expiryBlock = null; this.stopPrice = null; this.takeProfitPrice = null; this.favorablePrice = null;
    return { status: "closed", action, price: px, size, feeUsd: fee, slippageBps: impactBps(book, action, raw), notionalUsd, realizedPnlUsd: pnl - fee, simulated: true, note };
  }

  private held(note: string): PaperExecution {
    return { status: "held", action: "hold", price: null, size: 0, feeUsd: 0, slippageBps: 0, notionalUsd: 0, realizedPnlUsd: null, simulated: true, note };
  }
}

export function executablePrice(book: Book, action: "buy" | "sell", size: number): number | null {
  const levels = action === "buy" ? book.levels.asks : book.levels.bids;
  let remaining = size;
  let notional = 0;
  for (const [price, available] of levels) {
    const filled = Math.min(remaining, available);
    notional += price * filled;
    remaining -= filled;
    if (remaining <= 0) return notional / size;
  }
  return null;
}

const cushion = (price: number, action: "buy" | "sell") => action === "buy"
  ? price * (1 + config.paperSlippageBps / 10_000)
  : price * (1 - config.paperSlippageBps / 10_000);

const impactBps = (book: Book, action: "buy" | "sell", price: number) => {
  const touch = action === "buy" ? book.ask : book.bid;
  return Math.abs(((price - touch) / touch) * 10_000) + config.paperSlippageBps;
};

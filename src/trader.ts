import { config } from "./config";
import type { Book } from "./book";
import { Market } from "./market";
import { TradeFeed, type TradePrint } from "./trades";
import { MidRing, computeFeatures, type Features } from "./features";
import { createModel, withTimeout, buildState, mockAnswers, type Answers, type Model, type ModelState } from "./model";
import { decidePolicy, simFill, type RestingSnap } from "./policy";
import { logEvent } from "./log";
import type { BlockEvent, Decision, Fill, Position, Posture, Quote, Sensors, Totals } from "./types";

export type { BlockEvent };

type OnBlock = (e: BlockEvent) => void;
type OnFill = (block: number, fill: Fill) => void;
type OnQuote = (block: number, quote: Quote) => void;

interface PendingMarkout { block: number; price: number; side: "buy" | "sell"; fill: Fill }

const emptyTotals = (): Totals => ({
  blocks: 0, decisions: 0, quotes: 0, sits: 0, pulls: 0, fills: 0, reverted: 0, lateBlocks: 0,
  modelUsd: 0, gasMon: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlMon: 0, pnlPct: 0,
  fillRate: 0, markout10Bps: null, postureAutocorr: null,
});

function posView(q: number, entry: number | null, mid: number): Position {
  if (Math.abs(q) < 1e-9) return { side: "flat", size: 0, entryPrice: null, unrealizedUsd: 0, unrealizedMon: 0 };
  const side = q > 0 ? "long" : "short";
  const size = Math.abs(q);
  const entryPrice = entry ?? mid;
  const unrealizedUsd = q * (mid - entryPrice);
  return { side, size, entryPrice, unrealizedUsd, unrealizedMon: mid ? unrealizedUsd / mid : 0 };
}

export class Trader {
  readonly history: BlockEvent[] = [];
  private totals = emptyTotals();
  private q = 0;
  private entry: number | null = null;
  private realizedUsd = 0;
  private busy = false;
  private lastBook: Book | null = null;
  private lastAnswers: Answers | null = null;
  private lastPosture: Posture = "sit";
  private lastTouch: { bid: number; ask: number } | null = null;
  private blocksSinceQuoteChange = 0;
  private resting: RestingSnap = { bid: null, ask: null, ageBlocks: 0 };
  private liveIds = new Set<number>();
  private paused = false;
  private ring = new MidRing();
  private postures: Posture[] = [];
  private markouts: PendingMarkout[] = [];
  private markoutSamples: number[] = [];
  private midsByBlock = new Map<number, number>();
  private trades: TradeFeed | null = null;
  private model: Model;

  constructor(
    private market: Market,
    private onBlock: OnBlock,
    private onFill: OnFill,
    private onQuote: OnQuote,
  ) {
    const inner = createModel();
    this.model = config.model === "mock" ? inner : withTimeout(inner, 180);
  }

  get modelName() { return this.model.name; }

  attachTradeFeed(sizeDec: number) {
    this.trades = new TradeFeed({
      market: config.market,
      url: config.readRpcUrl,
      sizeDec,
      maker: this.market.address,
    });
  }

  async onHead(block: number) {
    this.trades?.poll(block);
    if (this.busy) {
      this.totals.lateBlocks++;
      this.totals.blocks++;
      const book = this.lastBook;
      if (book) this.emitLate(block, book);
      return;
    }
    this.busy = true;
    const t0 = Date.now();
    try {
      await this.step(block, t0);
    } catch (e) {
      console.warn(`#${block} ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async step(block: number, t0: number) {
    const book = await this.market.readBook();
    this.lastBook = book;
    this.ring.push(book.mid, book.spreadBps);
    this.midsByBlock.set(block, book.mid);
    if (this.midsByBlock.size > 400) {
      const min = block - 300;
      for (const k of this.midsByBlock.keys()) if (k < min) this.midsByBlock.delete(k);
    }
    if (block % config.refreshBlocks === 0) this.market.refresh();

    const prints = this.trades?.drainPrints() ?? [];
    const liveFills = this.trades?.drainFills() ?? [];
    let fill: Fill | null = this.harvest(block, book, prints, liveFills);

    this.resolveMarkouts(block);

    const summary = this.trades?.summary(config.horizonBlocks, block) ?? {
      count: 0, buyMon: 0, sellMon: 0, cvdMon: 0, vwap: null, lastPrice: null, lastSide: null,
    };
    const feat = computeFeatures(book, this.ring, summary, this.q, null);

    if (this.totals.pnlUsd <= -config.maxLossUsd) this.paused = true;

    const touchUnchanged = this.lastTouch != null && this.lastTouch.bid === book.bid && this.lastTouch.ask === book.ask;
    const loopMs = Date.now() - t0;
    const lateBudget = loopMs > config.loopBudgetMs;

    let answers: Answers;
    let skipped = false;
    if (this.lastAnswers && this.lastAnswers.hold > config.holdTau && touchUnchanged && !this.paused) {
      answers = { ...this.lastAnswers, skipped: true, latencyMs: 0 };
      skipped = true;
    } else {
      const state = this.modelState(block, book, feat, summary);
      try {
        answers = await this.model.decide(state);
      } catch (e) {
        answers = this.lastAnswers
          ? { ...this.lastAnswers, skipped: true, latencyMs: Date.now() - t0 }
          : { ...mockAnswers(state), skipped: true };
        skipped = true;
        console.warn(`#${block} model ${(e as Error).message}`);
      }
    }
    this.lastAnswers = answers;
    this.totals.modelUsd += (answers.inputTokens / 1e6) * config.jevUsdPerMTok;
    this.totals.decisions++;

    const desired = decidePolicy({
      book, feat, answers, q: this.q, resting: this.resting,
      touchUnchanged, late: lateBudget, paused: this.paused,
      priceDec: this.market.priceDec, tickUnits: this.market.tickUnits,
      dryRun: config.dryRun, gasUsd: this.market.lastGasMon * book.mid,
    });

    let quote: Quote;
    if (desired.send) {
      const cancel = [...this.liveIds].filter((id) => id > 0);
      quote = await this.market.sendBoth(block, desired.bid, desired.ask, cancel);
      this.resting = { bid: desired.bid, ask: desired.ask, ageBlocks: 0 };
      this.blocksSinceQuoteChange = 0;
      if (config.dryRun) {
        this.liveIds.clear();
        if (quote.orderIdBid) this.liveIds.add(quote.orderIdBid);
        if (quote.orderIdAsk) this.liveIds.add(quote.orderIdAsk);
      } else {
        this.liveIds.clear(); // wait for receipt ids
      }
      this.totals.quotes++;
      this.totals.gasMon += quote.gasMon;
      this.totals.gasUsd += quote.gasMon * book.mid;
      if (desired.pull) this.totals.pulls++;
    } else {
      this.resting = { ...this.resting, ageBlocks: this.resting.ageBlocks + 1 };
      this.blocksSinceQuoteChange++;
      quote = {
        bid: this.resting.bid, ask: this.resting.ask, txHash: null, gasMon: 0, cancel: [],
        status: this.resting.bid || this.resting.ask ? "resting" : "none",
        sent: false,
        orderIdBid: null, orderIdAsk: null,
      };
      if (desired.posture === "sit" || desired.posture === "late") this.totals.sits++;
      if (desired.posture === "pull") this.totals.pulls++;
    }

    this.lastTouch = { bid: book.bid, ask: book.ask };
    this.lastPosture = desired.posture;
    this.postures.push(desired.posture);
    if (this.postures.length > 400) this.postures.splice(0, this.postures.length - 400);

    const results = await this.market.pollPending(block);
    for (const r of results) {
      if (r.quote.status === "placed") {
        if (r.quote.orderIdBid) this.liveIds.add(r.quote.orderIdBid);
        if (r.quote.orderIdAsk) this.liveIds.add(r.quote.orderIdAsk);
      }
      if (r.quote.status === "reverted") this.totals.reverted++;
      this.patchQuote(r.block, r.quote);
      this.onQuote(r.block, r.quote);
    }

    this.totals.blocks++;
    this.totals.realizedUsd = this.realizedUsd;
    const pos = posView(this.q, this.entry, book.mid);
    this.totals.pnlUsd = this.realizedUsd + pos.unrealizedUsd - this.totals.gasUsd;
    this.totals.pnlMon = book.mid ? this.totals.pnlUsd / book.mid : 0;
    this.totals.pnlPct = (this.totals.pnlUsd / config.bankrollUsd) * 100;
    this.totals.fillRate = this.totals.quotes ? this.totals.fills / this.totals.quotes : 0;
    this.totals.markout10Bps = this.markoutSamples.length
      ? this.markoutSamples.reduce((a, b) => a + b, 0) / this.markoutSamples.length
      : null;
    this.totals.postureAutocorr = this.autocorr();

    const sensors: Sensors = {
      toxic: answers.toxic, stale: answers.stale, hold: answers.hold,
      widthTicks: answers.widthTicks, sizeMult: answers.sizeMult, regime: answers.regime,
      latencyMs: answers.latencyMs, skipped,
    };
    const decision: Decision = {
      posture: desired.posture,
      sensors,
      late: desired.posture === "late",
      probabilities: answers.probabilities,
    };
    const event: BlockEvent = {
      block, ts: Date.now(),
      mid: book.mid, bestBid: book.bid, bestAsk: book.ask, spreadBps: book.spreadBps, microprice: book.microprice,
      decision, quote, fill,
      resting: { bidMon: this.resting.bid?.size ?? 0, askMon: this.resting.ask?.size ?? 0 },
      position: pos,
      totals: { ...this.totals },
    };
    this.push(event);
    this.onBlock(event);
    logEvent({ block, posture: desired.posture, skipped, sent: quote.sent, fill: fill?.side ?? null, pnl: this.totals.pnlUsd });
  }

  private harvest(block: number, book: Book, prints: TradePrint[], live: { block: number; txHash: string; orderId: number; price: number; size: number; updatedSize: number; side: "buy" | "sell" }[]): Fill | null {
    let last: Fill | null = null;
    if (config.dryRun) {
      for (const p of prints) {
        const hit = simFill(p, this.resting);
        if (!hit) continue;
        const fill: Fill = {
          side: hit.side, size: hit.size, price: hit.price,
          txHash: null, orderId: hit.side === "buy" ? (this.resting as any) : 0,
          simulated: true, markout10Bps: null,
        };
        fill.orderId = hit.side === "buy" ? -1 : -2;
        this.applyFill(fill);
        this.noteMarkout(block, fill);
        last = fill;
        this.onFill(block, fill);
        if (hit.side === "buy" && this.resting.bid) {
          const left = this.resting.bid.size - hit.size;
          this.resting = { ...this.resting, bid: left > 1e-9 ? { ...this.resting.bid, size: left } : null };
        }
        if (hit.side === "sell" && this.resting.ask) {
          const left = this.resting.ask.size - hit.size;
          this.resting = { ...this.resting, ask: left > 1e-9 ? { ...this.resting.ask, size: left } : null };
        }
      }
    } else {
      for (const f of live) {
        const fill: Fill = {
          side: f.side, size: f.size, price: f.price, txHash: f.txHash,
          orderId: f.orderId, simulated: false, markout10Bps: null,
        };
        this.applyFill(fill);
        this.noteMarkout(block, fill);
        this.liveIds.delete(f.orderId);
        last = fill;
        this.onFill(block, fill);
      }
    }
    return last;
  }

  private applyFill(fill: Fill) {
    const signed = fill.side === "buy" ? fill.size : -fill.size;
    if (this.q === 0 || Math.sign(this.q) === Math.sign(signed)) {
      const newAbs = Math.abs(this.q) + fill.size;
      this.entry = this.entry == null ? fill.price : (this.entry * Math.abs(this.q) + fill.price * fill.size) / newAbs;
      this.q += signed;
    } else {
      const closing = Math.min(Math.abs(this.q), fill.size);
      this.realizedUsd += Math.sign(this.q) * closing * (fill.price - (this.entry ?? fill.price)) * (this.q > 0 ? 1 : -1);
      // long close: sell higher than entry is +; q>0, fill sell, (fill - entry)*closing
      this.q += signed;
      if (Math.abs(this.q) < 1e-9) { this.q = 0; this.entry = null; }
      else if (Math.sign(this.q) !== Math.sign(this.q - signed)) this.entry = fill.price;
    }
    this.totals.fills++;
  }

  private noteMarkout(block: number, fill: Fill) {
    this.markouts.push({ block, price: fill.price, side: fill.side, fill });
  }

  private resolveMarkouts(block: number) {
    const keep: PendingMarkout[] = [];
    for (const m of this.markouts) {
      if (block < m.block + 10) { keep.push(m); continue; }
      const mid = this.midsByBlock.get(m.block + 10) ?? this.lastBook?.mid;
      if (mid == null || m.price === 0) continue;
      const sign = m.side === "buy" ? 1 : -1;
      const bps = sign * (mid - m.price) / m.price * 10_000;
      m.fill.markout10Bps = bps;
      this.markoutSamples.push(bps);
      if (this.markoutSamples.length > 200) this.markoutSamples.splice(0, this.markoutSamples.length - 200);
    }
    this.markouts = keep;
  }

  private autocorr(): number | null {
    const p = this.postures;
    if (p.length < 20) return null;
    let same = 0;
    for (let i = 1; i < p.length; i++) if (p[i] === p[i - 1]) same++;
    return same / (p.length - 1);
  }

  private modelState(block: number, book: Book, feat: Features, trades: ReturnType<TradeFeed["summary"]>): ModelState {
    const recent = (this.trades?.recent(10) ?? []).map((t) => `${t.block} ${t.side} ${t.size.toFixed(1)} @ ${t.price.toFixed(6)}`);
    return buildState({
      block, book, feat, trades, recentTrades: recent, recentMids: this.ring.sampled(),
      q: this.q,
      resting: {
        bidMon: this.resting.bid?.size ?? 0,
        askMon: this.resting.ask?.size ?? 0,
        bidPx: this.resting.bid?.price ?? null,
        askPx: this.resting.ask?.price ?? null,
        ageBlocks: this.resting.ageBlocks,
      },
      last: {
        posture: this.lastPosture,
        toxic: this.lastAnswers?.toxic ?? 0,
        stale: this.lastAnswers?.stale ?? 0,
        hold: this.lastAnswers?.hold ?? 0,
        blocksSinceQuoteChange: this.blocksSinceQuoteChange,
      },
    });
  }

  private emitLate(block: number, book: Book) {
    const pos = posView(this.q, this.entry, book.mid);
    const answers = this.lastAnswers ?? mockAnswers(this.modelState(block, book, computeFeatures(book, this.ring, {
      count: 0, buyMon: 0, sellMon: 0, cvdMon: 0, vwap: null, lastPrice: null, lastSide: null,
    }, this.q, null), { count: 0, buyMon: 0, sellMon: 0, cvdMon: 0, vwap: null, lastPrice: null, lastSide: null }));
    const quote: Quote = {
      bid: this.resting.bid, ask: this.resting.ask, txHash: null, gasMon: 0, cancel: [],
      status: this.resting.bid || this.resting.ask ? "resting" : "none",
      sent: false, orderIdBid: null, orderIdAsk: null,
    };
    const event: BlockEvent = {
      block, ts: Date.now(), mid: book.mid, bestBid: book.bid, bestAsk: book.ask,
      spreadBps: book.spreadBps, microprice: book.microprice,
      decision: {
        posture: "late", late: true, probabilities: answers.probabilities,
        sensors: {
          toxic: answers.toxic, stale: answers.stale, hold: answers.hold,
          widthTicks: answers.widthTicks, sizeMult: answers.sizeMult, regime: answers.regime,
          latencyMs: 0, skipped: true,
        },
      },
      quote, fill: null,
      resting: { bidMon: this.resting.bid?.size ?? 0, askMon: this.resting.ask?.size ?? 0 },
      position: pos, totals: { ...this.totals },
    };
    this.push(event);
    this.onBlock(event);
  }

  private patchQuote(block: number, quote: Quote) {
    const e = this.history.find((x) => x.block === block);
    if (e) e.quote = { ...e.quote, ...quote };
  }

  private push(e: BlockEvent) {
    this.history.push(e);
    if (this.history.length > config.historySize) this.history.splice(0, this.history.length - config.historySize);
  }
}

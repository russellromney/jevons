import { config } from "../config";
import { computeFeatures, MidRing } from "../features";
import { logDirectional, readDirectionalState } from "../log";
import { Market } from "../market";
import { TradeFeed } from "../trades";
import { classifyCandidate } from "./jev";
import { applyGateConviction, evaluateStrategy } from "./engines";
import { PaperExecutor } from "./paper";
import { ReferenceFeed } from "./reference";
import { STRATEGIES, type DirectionalEvent, type DirectionalSignals, type FeedHealth, type StrategyId } from "./types";

const blankHealth = (): FeedHealth => ({ kuru: "live", reference: "missing", liquidation: "missing", funding: "missing", events: "missing" });

export class DirectionalTrader {
  readonly history: DirectionalEvent[] = [];
  readonly executions: DirectionalEvent[] = [];
  private active: StrategyId = config.strategy;
  private busy = false;
  private ring = new MidRing();
  private trades: TradeFeed | null = null;
  private paper = new PaperExecutor();
  private reference = new ReferenceFeed();
  private latest: DirectionalEvent | null = null;

  constructor(private market: Market, private onBlock: (event: DirectionalEvent) => void) {
    // The paper costs follow the actual market parameter, not a stale default.
    config.takerFeeBps = market.params.takerFeeBps.toNumber();
  }

  get strategy() { return this.active; }
  get modelName() { return config.model === "jev" && config.typesafeKey ? config.jevModelId : "deterministic-gate"; }
  get strategies() { return STRATEGIES; }

  setStrategy(value: string): StrategyId | null {
    if (!(STRATEGIES as readonly string[]).includes(value)) return null;
    this.active = value as StrategyId;
    return this.active;
  }

  async start() {
    const restored = await readDirectionalState(config.historySize);
    if (restored.history.length) {
      this.history.push(...restored.history);
      this.executions.push(...restored.executions);
      this.paper.restore(restored.history.at(-1)!);
      console.log(`restored ${restored.history.length} directional events from paper log`);
    }
    this.reference.start();
    this.trades = new TradeFeed({ market: config.market, url: config.readRpcUrl, sizeDec: this.market.sizeDec });
  }

  async onHead(block: number) {
    this.trades?.poll(block);
    if (this.busy) return;
    this.busy = true;
    try { await this.step(block); }
    catch (error) { console.warn(`#${block} directional ${(error as Error).message}`); }
    finally { this.busy = false; }
  }

  private async step(block: number) {
    const book = await this.market.readBook();
    this.ring.push(book.mid, book.spreadBps);
    const reference = this.reference.snapshot();
    const health = blankHealth();
    health.reference = this.reference.status();
    health.funding = reference?.fundingRate == null ? "missing" : health.reference;
    const summary = this.trades?.summary(config.horizonBlocks, block) ?? { count: 0, buyMon: 0, sellMon: 0, cvdMon: 0, vwap: null, lastPrice: null, lastSide: null };
    const basisBps = reference && health.reference === "live" ? ((reference.mid - book.mid) / book.mid) * 10_000 : null;
    const features = computeFeatures(book, this.ring, summary, 0, basisBps);

    const exit = this.paper.update(block, book);
    let candidate = null;
    let reason = exit?.note ?? "";
    let gate = null;
    let signals: DirectionalSignals = { basisBps, referenceReturnBps: reference?.ret1Bps ?? null, kuruReturnBps: features.ret5, entryCostBps: 0, roundTripCostBps: 0, residualBps: null };
    if (!exit) {
      const evaluated = evaluateStrategy(this.active, { block, book, features, reference, health, equityUsd: this.paper.portfolio(book.mid).equityUsd });
      candidate = evaluated.candidate; reason = evaluated.holdReason; signals = evaluated.signals;
      if (candidate) {
        if (config.model === "jev" && config.typesafeKey) this.paper.totals.llmCalls++;
        gate = await classifyCandidate({ strategy: this.active, candidate, kuru: { mid: book.mid, ret1Bps: features.ret1, ret5Bps: features.ret5, spreadBps: features.spreadBps, imbalance: features.imbalance, cvdMon: features.cvdMon }, reference });
        candidate = applyGateConviction(this.active, candidate, gate, book);
        if (!gate.accepted) reason = gate.reason;
      }
    }

    const execution = exit ?? this.paper.consider(block, book, candidate, gate?.accepted ?? false, reason || "no candidate");
    // Update after an open/close so every event contains current P&L.
    this.paper.update(block, book, false);
    const action = execution.action;
    const event: DirectionalEvent = {
      block, ts: Date.now(), strategy: this.active, mid: book.mid, bestBid: book.bid, bestAsk: book.ask, spreadBps: book.spreadBps,
      reference, feedHealth: health,
      signals,
      decision: { strategy: this.active, action, reason: execution.note || reason || "hold", candidate, jev: gate, late: false },
      execution, position: this.paper.position(book.mid), portfolio: this.paper.portfolio(book.mid), totals: { ...this.paper.totals },
    };
    this.latest = event; this.history.push(event);
    if (this.history.length > config.historySize) this.history.splice(0, this.history.length - config.historySize);
    if (execution.status === "opened" || execution.status === "closed") {
      this.executions.push(event);
      if (this.executions.length > 100) this.executions.shift();
    }
    this.onBlock(event); logDirectional(event);
  }
}

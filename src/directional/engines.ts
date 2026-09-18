import { config } from "../config";
import type { Book } from "../book";
import type { Features } from "../features";
import { executablePrice } from "./paper";
import type { Candidate, DirectionalSignals, FeedHealth, JevGate, ReferencePrice, StrategyId } from "./types";

export interface EngineState {
  block: number;
  book: Book;
  features: Features;
  reference: ReferencePrice | null;
  health: FeedHealth;
  equityUsd?: number;
}

export interface EngineResult {
  candidate: Candidate | null;
  holdReason: string;
  signals: DirectionalSignals;
}

const roundTripCostForSize = (state: EngineState, sizeMon: number): number => {
  const buyVwap = executablePrice(state.book, "buy", sizeMon);
  const sellVwap = executablePrice(state.book, "sell", sizeMon);
  if (buyVwap == null || sellVwap == null) return Infinity;
  const buyImpact = ((buyVwap - state.book.ask) / state.book.ask) * 10_000;
  const sellImpact = ((state.book.bid - sellVwap) / state.book.bid) * 10_000;
  const entryCost = state.features.spreadBps / 2 + config.takerFeeBps + config.paperSlippageBps + Math.max(buyImpact, sellImpact);
  return entryCost * 2;
};

const costSignals = (state: EngineState): DirectionalSignals => {
  const basisBps = state.reference ? ((state.reference.mid - state.book.mid) / state.book.mid) * 10_000 : null;
  const roundTripCostBps = roundTripCostForSize(state, config.directionalSizeMon);
  const entryCostBps = roundTripCostBps / 2;
  return {
    basisBps,
    referenceReturnBps: state.reference?.ret1Bps ?? null,
    kuruReturnBps: state.features.ret5,
    entryCostBps,
    roundTripCostBps,
    residualBps: state.reference ? state.reference.ret1Bps - state.features.ret5 : null,
  };
};
const hold = (state: EngineState, holdReason: string): EngineResult => ({ candidate: null, holdReason, signals: costSignals(state) });
const direction = (x: number): "buy" | "sell" => x >= 0 ? "buy" : "sell";
const costs = (state: EngineState) => costSignals(state).roundTripCostBps;

/** Scale paper notional from current equity, then cap it by displayed depth. */
export function sizeForEdge(state: EngineState, action: "buy" | "sell", edgeBps: number): number {
  const levels = action === "buy" ? state.book.levels.asks : state.book.levels.bids;
  const displayed = levels.reduce((sum, [, size]) => sum + size, 0);
  const range = Math.max(5, config.minExpectedEdgeBps);
  const conviction = Math.max(0, Math.min(1, (edgeBps - config.minExpectedEdgeBps) / range));
  const leverage = config.minPaperLeverage
    + (config.maxPaperLeverage - config.minPaperLeverage) * conviction ** 2;
  const equity = Math.max(1, state.equityUsd ?? config.bankrollUsd);
  const desired = equity * leverage / state.book.mid;
  const cap = Math.min(config.maxDirectionalSizeMon, displayed * 0.5);
  if (cap < config.minDirectionalSizeMon) return 0;
  const grossEdgeBps = edgeBps + costs(state);
  const viable = (size: number) => grossEdgeBps - roundTripCostForSize(state, size) >= config.minExpectedEdgeBps;
  if (!viable(config.minDirectionalSizeMon)) return 0;
  let low = Math.floor(config.minDirectionalSizeMon / 5);
  let high = Math.floor(Math.min(desired, cap) / 5);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (viable(mid * 5)) low = mid;
    else high = mid - 1;
  }
  return low * 5;
}

/** Let a real Jev confirmation amplify size, without allowing it to bypass hard caps. */
export function applyGateConviction(strategy: StrategyId, candidate: Candidate, gate: JevGate, book: Book): Candidate {
  if (!gate.used || !gate.accepted) return candidate;
  const conviction = strategy === "mean_reversion"
    ? gate.transientShock * (1 - gate.continuation)
    : strategy === "liquidation"
      ? gate.forcedFlow * gate.continuation
      : strategy === "event"
        ? gate.eventMaterial
        : strategy === "carry"
          ? 1 - gate.exhaustion
          : gate.continuation * (1 - gate.exhaustion);
  const multiplier = 0.5 + 1.5 * Math.max(0, Math.min(1, conviction));
  const levels = candidate.action === "buy" ? book.levels.asks : book.levels.bids;
  const displayed = levels.reduce((sum, [, size]) => sum + size, 0);
  const cap = Math.min(config.maxDirectionalSizeMon, displayed * 0.5);
  const scaled = Math.floor(Math.min(cap, candidate.sizeMon * multiplier) / 5) * 5;
  const sizeMon = Math.max(config.minDirectionalSizeMon, scaled);
  return { ...candidate, sizeMon };
}

function cexLag(state: EngineState): EngineResult {
  if (state.health.reference !== "live" || !state.reference) return hold(state, "reference feed unavailable or stale");
  const signals = costSignals(state);
  const unabsorbedMoveBps = signals.residualBps!;
  const edge = Math.abs(unabsorbedMoveBps) - costs(state);
  if (Math.abs(state.reference.ret1Bps) < config.referenceImpulseBps) return hold(state, "reference impulse below trigger");
  if (unabsorbedMoveBps * state.reference.ret1Bps <= 0) return hold(state, "Kuru already absorbed the reference impulse");
  if (edge < config.minExpectedEdgeBps) return hold(state, "unabsorbed move does not clear round-trip costs");
  const action = direction(unabsorbedMoveBps);
  const sizeMon = sizeForEdge(state, action, edge);
  if (!sizeMon) return hold(state, "insufficient displayed depth for minimum size");
  return {
    candidate: {
      action, sizeMon, reason: `reference leads Kuru by ${unabsorbedMoveBps.toFixed(1)} bps`, expectedEdgeBps: edge,
      signalBps: unabsorbedMoveBps, maxHoldMs: config.cexMaxHoldMs, horizonBlocks: 0,
      stopBps: Math.max(12, Math.min(30, Math.abs(unabsorbedMoveBps))),
      takeProfitBps: Math.max(6, Math.min(25, Math.abs(unabsorbedMoveBps) * 0.75)), hedged: false,
      requiredFeeds: ["kuru", "reference"],
    }, holdReason: "", signals,
  };
}

function liquidation(state: EngineState): EngineResult {
  // A CVD spike is not called liquidation. Without a verified liquidation feed,
  // this engine stays flat; this is an explicit safety property.
  if (state.health.liquidation !== "live") return hold(state, "verified liquidation feed unavailable");
  const volume = state.features.cvdMon;
  if (Math.abs(volume) < config.directionalSizeMon * 5) return hold(state, "forced flow below trigger");
  const action = direction(volume);
  const sizeMon = sizeForEdge(state, action, 15);
  if (!sizeMon) return hold(state, "insufficient displayed depth for minimum size");
  return {
    candidate: {
      action, sizeMon, reason: "verified forced flow persists into Kuru depth", expectedEdgeBps: 15,
      signalBps: 15, maxHoldMs: config.cexMaxHoldMs, horizonBlocks: 0, stopBps: 10, takeProfitBps: 12, hedged: false,
      requiredFeeds: ["kuru", "liquidation"],
    }, holdReason: "", signals: costSignals(state),
  };
}

function carry(state: EngineState): EngineResult {
  if (state.health.reference !== "live" || state.health.funding !== "live" || !state.reference) return hold(state, "reference or funding feed unavailable");
  // Carry needs an actual matched futures leg. This executor only simulates Kuru,
  // so treating it as a directional paper order would lie about the strategy.
  return hold(state, "hedged carry executor not configured");
}

function eventDriven(state: EngineState): EngineResult {
  if (state.health.events !== "live") return hold(state, "verified MON event feed unavailable");
  return hold(state, "event feed has no actionable signed event");
}

function meanReversion(state: EngineState): EngineResult {
  if (state.health.reference !== "live" || !state.reference) return hold(state, "reference feed unavailable or stale");
  const shock = state.features.ret1;
  if (Math.abs(shock) < 8) return hold(state, "local Kuru shock below trigger");
  if (Math.abs(state.reference.ret1Bps) > config.referenceImpulseBps) return hold(state, "reference confirms move; do not fade");
  const edge = Math.abs(shock) - costs(state);
  if (edge < config.minExpectedEdgeBps) return hold(state, "reversion does not clear execution costs");
  const action = shock > 0 ? "sell" : "buy";
  const sizeMon = sizeForEdge(state, action, edge);
  if (!sizeMon) return hold(state, "insufficient displayed depth for minimum size");
  return {
    candidate: {
      action, sizeMon, reason: `local ${shock.toFixed(1)} bps shock with stable reference`, expectedEdgeBps: edge,
      signalBps: shock, maxHoldMs: config.meanReversionMaxHoldMs, horizonBlocks: 0,
      stopBps: Math.max(12, Math.min(35, Math.abs(shock))),
      takeProfitBps: Math.max(8, Math.min(30, Math.abs(shock) * 0.75)), hedged: false,
      requiredFeeds: ["kuru", "reference"],
    }, holdReason: "", signals: costSignals(state),
  };
}

export function evaluateStrategy(strategy: StrategyId, state: EngineState): EngineResult {
  if (state.health.kuru !== "live") return hold(state, "Kuru feed unavailable");
  switch (strategy) {
    case "cex_lag": return cexLag(state);
    case "liquidation": return liquidation(state);
    case "carry": return carry(state);
    case "event": return eventDriven(state);
    case "mean_reversion": return meanReversion(state);
  }
}

import { config } from "../config";
import type { Book } from "../book";
import type { Features } from "../features";
import { executablePrice } from "./paper";
import type { Candidate, DirectionalSignals, FeedHealth, ReferencePrice, StrategyId } from "./types";

export interface EngineState {
  block: number;
  book: Book;
  features: Features;
  reference: ReferencePrice | null;
  health: FeedHealth;
}

export interface EngineResult {
  candidate: Candidate | null;
  holdReason: string;
  signals: DirectionalSignals;
}

const costSignals = (state: EngineState): DirectionalSignals => {
  const basisBps = state.reference ? ((state.reference.mid - state.book.mid) / state.book.mid) * 10_000 : null;
  const buyVwap = executablePrice(state.book, "buy", config.directionalSizeMon);
  const sellVwap = executablePrice(state.book, "sell", config.directionalSizeMon);
  const buyImpact = buyVwap ? ((buyVwap - state.book.ask) / state.book.ask) * 10_000 : Infinity;
  const sellImpact = sellVwap ? ((state.book.bid - sellVwap) / state.book.bid) * 10_000 : Infinity;
  const entryCostBps = state.features.spreadBps / 2 + config.takerFeeBps + config.paperSlippageBps + Math.max(buyImpact, sellImpact);
  return {
    basisBps,
    referenceReturnBps: state.reference?.ret1Bps ?? null,
    kuruReturnBps: state.features.ret5,
    entryCostBps,
    roundTripCostBps: entryCostBps * 2,
    residualBps: state.reference ? state.reference.ret1Bps - state.features.ret5 : null,
  };
};
const hold = (state: EngineState, holdReason: string): EngineResult => ({ candidate: null, holdReason, signals: costSignals(state) });
const direction = (x: number): "buy" | "sell" => x >= 0 ? "buy" : "sell";
const costs = (state: EngineState) => costSignals(state).roundTripCostBps;

function cexLag(state: EngineState): EngineResult {
  if (state.health.reference !== "live" || !state.reference) return hold(state, "reference feed unavailable or stale");
  const signals = costSignals(state);
  const unabsorbedMoveBps = signals.residualBps!;
  const edge = Math.abs(unabsorbedMoveBps) - costs(state);
  if (Math.abs(state.reference.ret1Bps) < config.referenceImpulseBps) return hold(state, "reference impulse below trigger");
  if (unabsorbedMoveBps * state.reference.ret1Bps <= 0) return hold(state, "Kuru already absorbed the reference impulse");
  if (edge < config.minExpectedEdgeBps) return hold(state, "unabsorbed move does not clear round-trip costs");
  return {
    candidate: {
      action: direction(unabsorbedMoveBps), reason: `reference leads Kuru by ${unabsorbedMoveBps.toFixed(1)} bps`, expectedEdgeBps: edge,
      horizonBlocks: 25, stopBps: 12, takeProfitBps: Math.min(Math.abs(unabsorbedMoveBps), 24), hedged: false,
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
  return {
    candidate: {
      action: direction(volume), reason: "verified forced flow persists into Kuru depth", expectedEdgeBps: 15,
      horizonBlocks: 15, stopBps: 10, takeProfitBps: 12, hedged: false,
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
  return {
    candidate: {
      action: shock > 0 ? "sell" : "buy", reason: `local ${shock.toFixed(1)} bps shock with stable reference`, expectedEdgeBps: edge,
      horizonBlocks: 40, stopBps: 14, takeProfitBps: Math.max(8, edge * 0.5), hedged: false,
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

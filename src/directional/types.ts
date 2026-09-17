export const STRATEGIES = ["cex_lag", "liquidation", "carry", "event", "mean_reversion"] as const;
export type StrategyId = typeof STRATEGIES[number];
export type Action = "buy" | "sell" | "hold";
export type FeedStatus = "live" | "stale" | "missing";

export interface ReferencePrice {
  source: string;
  mid: number;
  bid: number;
  ask: number;
  fundingRate: number | null;
  ret1Bps: number;
  updatedAt: number;
}

export interface FeedHealth {
  kuru: FeedStatus;
  reference: FeedStatus;
  liquidation: FeedStatus;
  funding: FeedStatus;
  events: FeedStatus;
}

export interface Candidate {
  action: Exclude<Action, "hold">;
  reason: string;
  expectedEdgeBps: number;
  horizonBlocks: number;
  stopBps: number;
  takeProfitBps: number;
  hedged: boolean;
  requiredFeeds: (keyof FeedHealth)[];
}

export interface JevGate {
  used: boolean;
  latencyMs: number;
  continuation: number;
  exhaustion: number;
  forcedFlow: number;
  transientShock: number;
  eventMaterial: number;
  accepted: boolean;
  reason: string;
}

export interface DirectionalDecision {
  strategy: StrategyId;
  action: Action;
  reason: string;
  candidate: Candidate | null;
  jev: JevGate | null;
  late: boolean;
}

export interface PaperExecution {
  status: "opened" | "closed" | "held" | "rejected";
  action: Action;
  price: number | null;
  size: number;
  feeUsd: number;
  slippageBps: number;
  notionalUsd: number;
  realizedPnlUsd: number | null;
  simulated: true;
  note: string;
}

export interface DirectionalPosition {
  side: "long" | "short" | "flat";
  size: number;
  entryPrice: number | null;
  openedBlock: number | null;
  expiryBlock: number | null;
  stopPrice: number | null;
  takeProfitPrice: number | null;
  unrealizedUsd: number;
}

export interface DirectionalTotals {
  blocks: number;
  decisions: number;
  holds: number;
  buys: number;
  sells: number;
  opened: number;
  closed: number;
  wins: number;
  losses: number;
  realizedUsd: number;
  unrealizedUsd: number;
  feesUsd: number;
  pnlUsd: number;
  pnlPct: number;
  maxDrawdownUsd: number;
  modelUsd: number;
}

/** Paper account ledger. Negative MON represents a simulated borrowed short. */
export interface DirectionalPortfolio {
  startingCapitalUsd: number;
  cashUsd: number;
  mon: number;
  markPrice: number;
  positionValueUsd: number;
  equityUsd: number;
}

/** Inputs and cost assumptions recorded on every block for audit and replay. */
export interface DirectionalSignals {
  basisBps: number | null;
  referenceReturnBps: number | null;
  kuruReturnBps: number;
  entryCostBps: number;
  roundTripCostBps: number;
  residualBps: number | null;
}

export interface DirectionalEvent {
  block: number;
  ts: number;
  strategy: StrategyId;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  reference: ReferencePrice | null;
  feedHealth: FeedHealth;
  signals: DirectionalSignals;
  decision: DirectionalDecision;
  execution: PaperExecution;
  position: DirectionalPosition;
  portfolio: DirectionalPortfolio;
  totals: DirectionalTotals;
}

export interface DirectionalMeta {
  name: "jevons";
  model: string;
  wallet: null;
  dryRun: true;
  market: string;
  marketName: "MON-USDC";
  bankrollUsd: number;
  startedAt: number;
  activeStrategy: StrategyId;
  strategies: readonly StrategyId[];
}

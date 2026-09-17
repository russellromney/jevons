export type Posture = "both" | "bid_only" | "ask_only" | "pull" | "flatten" | "sit" | "late";
export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface Meta {
  name: "sit";
  model: string;
  wallet: string | null;
  dryRun: boolean;
  market: string;
  marketName: "MON-USDC";
  startedAt: number;
  refFeed: boolean;
}

export interface Sensors {
  toxic: number;
  stale: number;
  hold: number;
  widthTicks: number;
  sizeMult: number;
  regime: "quiet" | "trend" | "toxic" | "event" | "stale_vs_cex";
  latencyMs: number;
  skipped: boolean;
}

export interface Decision {
  posture: Posture;
  sensors: Sensors;
  late: boolean;
  probabilities: Record<string, number>;
}

export type QuoteStatus = "resting" | "sent" | "placed" | "reverted" | "lost" | "sim" | "none";

export interface Quote {
  bid: { price: number; size: number } | null;
  ask: { price: number; size: number } | null;
  txHash: string | null;
  gasMon: number;
  cancel: number[];
  status: QuoteStatus;
  sent: boolean;
  orderIdBid: number | null;
  orderIdAsk: number | null;
}

export interface Fill {
  side: "buy" | "sell";
  size: number;
  price: number;
  txHash: string | null;
  orderId: number;
  simulated: boolean;
  markout10Bps: number | null;
}

export interface Position {
  side: "long" | "short" | "flat";
  size: number;
  entryPrice: number | null;
  unrealizedUsd: number;
  unrealizedMon: number;
}

export interface Totals {
  blocks: number;
  decisions: number;
  quotes: number;
  sits: number;
  pulls: number;
  fills: number;
  reverted: number;
  lateBlocks: number;
  modelUsd: number;
  gasMon: number;
  gasUsd: number;
  realizedUsd: number;
  pnlUsd: number;
  pnlMon: number;
  pnlPct: number;
  fillRate: number;
  markout10Bps: number | null;
  postureAutocorr: number | null;
}

export interface BlockEvent {
  block: number;
  ts: number;
  mid: number;
  bestBid: number;
  bestAsk: number;
  spreadBps: number;
  microprice: number;
  decision: Decision;
  quote: Quote;
  fill: Fill | null;
  resting: { bidMon: number; askMon: number };
  position: Position;
  totals: Totals;
}

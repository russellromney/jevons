# Wire contract

**One TypeScript module is the source of truth.** Bot and Next app must import it (workspace package `sit-types` or a relative copy generated in CI). If Fly `/` and the UI disagree, that is a bug, not a dashboard issue.

## HTTP

Base URL: Fly app, no trailing slash.

| Path | Type |
|---|---|
| `GET /` | `{ ...Meta, latest: BlockEvent \| null }` |
| `GET /history` | `BlockEvent[]` last ≤ 2000 |
| `GET /events` | SSE: `snapshot`, `block`, `quote`, `fill`, `ping` |
| CORS | `*` |

SSE `snapshot` payload: `{ ...Meta, history: BlockEvent[] }`  
`block`: one `BlockEvent`  
`quote`: `{ block, quote: Quote }`  
`fill`: `{ block, fill: Fill }`  
`ping`: number (ms epoch), every 10–15 s (Fly idle timeout)

## Types (implement exactly)

```ts
export type Posture = "both" | "bid_only" | "ask_only" | "pull" | "flatten" | "sit" | "late";

export interface Meta {
  name: "sit";
  model: string;          // "mock" | "luna" | "jev-latest" | etc
  wallet: string | null;
  dryRun: boolean;
  market: string;         // address
  marketName: "MON-USDC";
  startedAt: number;      // ms epoch — process start, used for uptime
  refFeed: boolean;       // true if CEX mid is wired
}

export interface Sensors {
  toxic: number;          // 0..1 noul
  stale: number;          // 0..1 noul
  hold: number;           // 0..1 noul
  widthTicks: number;     // 0..3 added to half-spread
  sizeMult: number;       // 0 | 0.5 | 1 | 2
  regime: "quiet" | "trend" | "toxic" | "event" | "stale_vs_cex";
  latencyMs: number;
  skipped: boolean;       // true if we reused last answers (SIT without a call)
}

export interface Decision {
  posture: Posture;
  sensors: Sensors;
  late: boolean;
  /** raw model probabilities for the posture choice, for the tape */
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
  sent: boolean;          // false when we sat
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
  markout10Bps: number | null;  // filled in later when horizon arrives
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
  decisions: number;      // sensor calls + reused sits that had a posture
  quotes: number;         // txs or sim places (not sits)
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
  fillRate: number;       // fills/quotes, 0 if quotes==0
  markout10Bps: number | null;
  postureAutocorr: number | null;  // lag-1 on posture id, rolling
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
```

## Invariants

- `quote` is **always** an object, never omitted. Empty book → `status: "none"`, both sides null.
- `dryRun` true ⇒ any fill has `simulated: true` and `txHash: null`.
- `totals.fills` is a number, never missing. UI must not `fmtInt(undefined)`.
- `decision.late` true ⇒ `posture === "late"`. Connecting clients with no events do not fake this.
- `sent === false` and `status === "resting"` is the happy path.

## Example `/` (dry-run sit)

```json
{
  "name": "sit",
  "model": "mock",
  "wallet": null,
  "dryRun": true,
  "market": "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
  "marketName": "MON-USDC",
  "startedAt": 1789610000000,
  "refFeed": false,
  "latest": {
    "block": 105560001,
    "ts": 1789610000300,
    "mid": 0.022500,
    "bestBid": 0.022496,
    "bestAsk": 0.022504,
    "spreadBps": 3.56,
    "microprice": 0.022499,
    "decision": {
      "posture": "sit",
      "late": false,
      "probabilities": { "both": 0.71, "pull": 0.05, "sit": 0.24 },
      "sensors": {
        "toxic": 0.18, "stale": 0.07, "hold": 0.81,
        "widthTicks": 0, "sizeMult": 1, "regime": "quiet",
        "latencyMs": 0, "skipped": true
      }
    },
    "quote": {
      "bid": { "price": 0.022496, "size": 200 },
      "ask": { "price": 0.022504, "size": 200 },
      "txHash": null, "gasMon": 0, "cancel": [],
      "status": "resting", "sent": false,
      "orderIdBid": -3, "orderIdAsk": -4
    },
    "fill": null,
    "resting": { "bidMon": 200, "askMon": 200 },
    "position": { "side": "flat", "size": 0, "entryPrice": null, "unrealizedUsd": 0, "unrealizedMon": 0 },
    "totals": {
      "blocks": 400, "decisions": 400, "quotes": 12, "sits": 380, "pulls": 8,
      "fills": 3, "reverted": 0, "lateBlocks": 5,
      "modelUsd": 0, "gasMon": 0, "gasUsd": 0,
      "realizedUsd": -0.02, "pnlUsd": -0.02, "pnlMon": -0.9, "pnlPct": -0.02,
      "fillRate": 0.25, "markout10Bps": -0.4, "postureAutocorr": 0.86
    }
  }
}
```

A reviewer should be able to tell this is not jev-trader from `sits >> quotes` and `fillRate` far from 1.

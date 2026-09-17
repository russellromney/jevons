# Architecture

## Layers

```
feeds (Kuru L2, trades, optional CEX mid, own receipts)
        │
        ▼
features (floats: mid, microprice, σ, imbalance, CVD, queue, inventory q, gas, CEX basis)
        │
        ▼
sensors ── mock | luna | jev     QUESTIONS.md, one parallel call
        │   skip call if hold-noul high AND touch unchanged AND |Δq|==0
        ▼
policy  Avellaneda reservation + gates (toxic, stale, late, EV < gas, cap)
        │
        ▼
execution  two-sided post-only; send only if quotes changed by ≥1 tick or posture pulled
        │
        ▼
risk    hard caps — model cannot override
        │
        ▼
log     jsonl (state, features, answers, quotes, fills, markouts)  [async]
```

Jev is **not** on the path that computes `r` or gas. It may skip entirely this block (SIT).

## Block budget (~300 ms)

Hot path, in order:

1. `eth_call` getL2Book (~18 ms public RPC) — `READ_RPC_URL`
2. Optionally reuse last Jev answers (SIT) — 0 ms
3. Else `model.decide(state)` — target p99 < 200 ms
4. Policy + encode + `eth_sendRawTransaction` only if sending — `RPC_URL`

Off path (do not await on the decision): trade log poll, receipts, fee refresh, CEX mid, jsonl flush.

If `busy` from last block: emit `late: true`, **do not cancel resting quotes**, do not call the model. Their bot treats late as hold-with-empty-book-reuse and still paints LATE all over a hung RPC. We keep the last known resting.

If `read + model` > 200 ms: skip send, count late-ish, keep resting.

## Features (code)

Compute every block from book + mids ring + trade summary + position:

| Name | Def |
|---|---|
| `mid` | (bestBid+bestAsk)/2 |
| `microprice` | size-weighted: `(ask*bidSize + bid*askSize)/(bidSize+askSize)` at touch |
| `spreadBps` | (ask-bid)/mid * 1e4 |
| `imbalance` | (bidDepth-askDepth)/(sum) within 1% of mid (keep their near-book def) |
| `sigma` | stdev of log returns of mid over last 100 blocks, annualized-ish not required — use per-block σ |
| `ret1, ret5, ret20` | bps |
| `cvdMon`, `lastSide` | taker tape over horizon |
| `queueBid`, `queueAsk` | size at touch |
| `q` | signed inventory in MON |
| `basisBps` | (cexMid - kuruMid)/kuruMid * 1e4 if CEX configured, else null |
| `gasUsd` | last known per-tx cost |

CEX feed is optional v1. If unset, `stale` noul still runs but policy **must not** one-side on stale unless `basisBps` is numeric. Document this in the UI as “no ref feed”.

## Avellaneda (code)

Reservation around **microprice** `s`:

```
r = s - q * gamma * sigma2 * horizonSec
half = clip( 0.5 * (gamma * sigma2 * horizonSec + (2/gamma)*ln(1+gamma/k))
           * s , minHalf, maxHalf )
```

Defaults (tune later, do not grid-search on one afternoon of tape):

- `gamma = 0.1` (risk aversion)
- `horizonSec = 30` (match 100 blocks * 0.3s — inventory horizon, not Jev’s question)
- `k = 50` (liquidity; if formula explodes, fall back to `half = max(1 tick, 0.3 * spread)`)
- `minHalf = 1 tick`, `maxHalf = 8 ticks` on MON-USDC (tick 1e-6)

Then:

```
bid = floorTick(r - half)
ask = ceilTick(r + half)
never cross: bid < bestAsk, ask > bestBid; if spread too tight, join touch
```

Inventory target: 0 (flat). `q` is signed MON.

Jev **width** score adds 0–3 ticks to `half`. Jev **size** score multiplies `TRADE_SIZE_MON`.

## Gates (code, ordered)

1. Late / loop over budget → SIT (keep resting).
2. `toxic > 0.65` **and** confidence usable → PULL (cancel all).
3. `stale > 0.65` and `basisBps` numeric and `|basis| > 2` ticks equivalent → one-sided with the lead (bid_only if CEX above, ask_only if CEX below) or pull the stale side.
4. `posture == pull` → PULL.
5. `posture == flatten` or `|q| + resting > MAX_POSITION_MON` → quote **reducing** side only. Do not invent the opposite of the sensor.
6. `hold > 0.7` and touch unchanged and posture not pull → SIT, skip send.
7. Expected half-spread * size * mid < gasUsd (live) → SIT, do not send a no-op requote.
8. Else BOTH (or bid_only / ask_only from posture) at `r ± half`.

Send `batchUpdate` iff:

- we need to cancel (pull/flatten change), or
- new bid/ask price or size differs from resting by ≥ 1 tick / min size.

**Sitting is a successful block.** Event.quote can be `status: "resting"` with the same prices and `sent: false`.

## Fills

### Live

Maker fills from Trade logs where `makerAddress == us`. Never treat our place tx as a fill.

### Dry-run (must not match jev-trader)

A simulated order rests from the **next** block until cancelled.

Fill **only if** a taker print **trades through** our price, not merely touches:

- Our bid fills only on taker **sell** with `print.price < ourBid` (strict), size `min(print, remaining)`.
- Our ask fills only on taker **buy** with `print.price > ourAsk`.

If you must have a queue model in v1, use: fill fraction `min(1, printSize / (touchSize + ourSize))` and only when print is at our price **and** touch size was fully consumed — still not 100%. Prefer strict through-price for v1; it will look “quiet” and that is correct.

Partial fills allowed. Remaining rests.

## Markouts

When a fill happens at time t, price p, side s:

```
markout_bps(n) = sideSign * (mid_{t+n} - p) / p * 1e4
sideSign = +1 for buy (we want mid up), -1 for sell
```

Report n = 10, 33, 100 blocks (~3s, 10s, 30s). Rolling mean of last 200 fills in `totals.markout10Bps`. If no fills yet, `null`, UI shows `—`.

This is the number that decides whether sensors work. If markout10 stays ≈ −half-spread, toxic filter is not helping.

## Position / P&L

Same signed inventory + cost basis as a proper VWAP inventory (their `applyFill` logic is fine).

```
pnlUsd = realizedUsd + unrealizedUsd - gasUsd
```

`pnlPct = pnlUsd / BANKROLL_USD * 100`. Default bankroll 100. Do not invent 48.

## Risk (not the model)

- `MAX_POSITION_MON` (default 1000)
- `MAX_LOSS_USD` per process (default 25) → pull, pause sends, keep sensors
- `MAX_GAS_USD_HOUR` live only
- Model timeout → SIT, increment late
- RPC error streak → reconnecting, no sends

## State sent to the model

Compact JSON. Include **previous answers** and `blocksSinceChange`. See `QUESTIONS.md`. Cap size so input tokens stay small (their state shape is a decent size target: top 5 levels, 10 prints, sampled mids).

## Repo layout

```
sit/
  PLAN.md ...          (this handoff, keep)
  src/                 Bun bot
    types.ts           generated or copied from CONTRACT.md
    config.ts
    chain.ts           stolen
    book.ts            stolen
    market.ts          stolen + quotePrice both sides
    trades.ts          stolen
    features.ts
    model.ts           Model interface + mock/luna/jev
    policy.ts          Avellaneda + gates
    trader.ts          loop
    server.ts          SSE
    log.ts             async jsonl
    index.ts
  web/                 Next.js App Router, TS, CSS modules (no Tailwind required)
  packages/types/      optional shared types — preferred so drift is impossible
  scripts/             bench-read, dry-encode (steal)
  fly.toml
  Dockerfile
  .env.example
```

Stack: **Bun + TypeScript + ethers 5 + kuru-sdk** for the bot (same as opponent, fastest path). Next.js on Vercel for web. Do not introduce Redis/Postgres for v1. History = in-memory ring 2000 + jsonl on disk (Fly volume).

## Tests (minimum)

- `policy.test.ts`: cap → reducing side only; toxic → pull; hold+same touch → no send; never cross.
- `fills.test.ts`: touch ≠ fill; through = fill; late block does not cancel.
- `schema.test.ts`: a fixture BlockEvent satisfies the UI type (round-trip JSON).

No need for a full book replay engine in v1.

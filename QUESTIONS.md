# Sensor questions

One model call, all questions in parallel. Same object for `luna` and `jev`. Mock implements the **policy-shaped** answers from features, not a random buy/sell.

## State (JSON)

Keep it compact. Include last cycle so the model can hold a view.

```ts
interface ModelState {
  market: "MON-USDC";
  block: number;
  blockMs: 300;
  mid: number;
  microprice: number;
  spreadBps: number;
  sigmaBlock: number;          // per-block vol
  imbalance: number;
  depth: { "10bps": { bid: number; ask: number }; "25bps": { bid: number; ask: number } };
  book: { bids: string[]; asks: string[] }; // "price x size", top 5
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string;          // sampled
  trades: { count: number; buyMon: number; sellMon: number; cvdMon: number; lastSide: "buy"|"sell"|null };
  recentTrades: string[];      // "block side size @ price"
  inventoryMon: number;        // signed
  inventoryTarget: 0;
  resting: { bidMon: number; askMon: number; bidPx: number|null; askPx: number|null; ageBlocks: number };
  last: {
    posture: string;
    toxic: number;
    stale: number;
    hold: number;
    blocksSinceQuoteChange: number;
  };
  basisBps: number | null;     // null if no ref feed
  execution: {
    style: "two-sided post-only limit quotes on Kuru";
    life: "quotes rest until touch moves or a gate pulls; they are not IOC and do not cross";
    weEarn: "spread if a taker hits us; we pay gas only when we send";
  };
}
```

## Questions

Use TypeSafe primitives. Luna adapter maps to JSON schema / structured outputs with the same ids.

### `toxic` — noul

Instructions: “Will the next maker fill on our resting bid or ask be informed: mid moves against our fill over the next ~10 seconds (~33 blocks) by more than half the spread?”

Gate: `toxic > 0.65` → policy PULL or widen (widthTicks at least 2). Recalibrate τ after 200 fills.

### `stale` — noul

“Is Kuru’s mid stale versus the reference mid (`basisBps`), such that a taker will pick off our quote on the stale side this block?”

If `basisBps` is null: still answer, but policy **ignores** stale for one-siding (see ARCHITECTURE).

### `hold` — noul

“Is last.posture still the right maker posture given that quotes rest and we only pay gas to change them? High means sit; do not churn.”

Policy: `hold > 0.7` and touch unchanged → skip send, `sensors.skipped = true`.

### `posture` — choice

Criteria:

| key | meaning |
|---|---|
| `both` | Two-sided around reservation |
| `bid_only` | Want to buy / reduce a short; no ask |
| `ask_only` | Want to sell / reduce a long; no bid |
| `pull` | Cancel everything; flow looks toxic or book broken |
| `flatten` | Inventory too large; reducing side only |

Do **not** include `buy`/`sell`. Do not include `sit` in the choice — sit is `hold` high + both still valid.

### `width` — score

Levels:

- 0: join the touch (quiet, two-way noise)
- 1: +1 tick
- 2: +2 ticks (elevated vol or mild toxic)
- 3: +3 ticks or more (event / thin)

`widthTicks = round(score)`.

### `size` — score

Levels: 0 none, 1 half, 2 full, 3 double. Map to `sizeMult` 0 / 0.5 / 1 / 2. Never 2 unless `|inventory|` is small and toxic is low.

### `regime` — choice

`quiet | trend | toxic | event | stale_vs_cex`

Code may use this only as a dashboard label in v1 if gates already cover behavior. Still ask it — cheap, parallel, useful on the tape.

## Prompt facts that must be true

The instructions must describe **post-only resting quotes**, not IOC, not “cross the spread”, not “decision every few blocks then market order”. If you copy jev-trader `QUESTIONS`, you have failed.

## Mock (no API)

Deterministic:

- `toxic` = sigmoid( |cvd|/vol + 2*1_{spreadBps > 2*median} - 1 )
- `stale` = 0 if basis null else sigmoid(|basisBps|/2)
- `hold` = 0.85 if last.blocksSinceQuoteChange > 0 and |ret1| < 1 and toxic < 0.4 else 0.2
- `posture` = flatten if |q| > 0.8*max; pull if toxic > 0.65; bid_only if q < -0.4*max; ask_only if q > 0.4*max; else both
- `width` = 0 quiet, 2 if sigma high
- `size` = 0 if toxic high else 2 (full)
- `regime` from the same branches

No hash-of-block noise. If the mock chatters, the **features** are chattering; fix hold.

## Luna adapter

OpenAI-compatible `chat.completions` with `response_format: json_schema` matching the answer object:

```ts
{
  toxic: number,
  stale: number,
  hold: number,
  posture: "both"|"bid_only"|"ask_only"|"pull"|"flatten",
  width: number,
  size: number,
  regime: string
}
```

Env: `LUNA_API_KEY`, `LUNA_BASE_URL`, `LUNA_MODEL` (default whatever Russell has as “luna max” — do not hardcode a dead slug; read env).

Timeout 180 ms. On timeout/error: reuse last answers, `late` not necessarily, `skipped` true, increment a sensor-error counter.

## Jev adapter

`experimental_evaluate` / TypeSafe SDK as in jev-trader `JevModel`, but **these** questions. `TYPESAFE_AI_API_KEY`, `JEV_MODEL_ID=jev-latest`. Same timeout. `modelUsd += inputTokens/1e6 * 0.042`.

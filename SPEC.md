# Product spec — sit

## One line

A live public dashboard of a **two-sided post-only market maker** on Kuru MON-USDC. A System One model (Jev, or a cheap stand-in) scores toxicity, staleness, and posture every block. Code places and rests quotes. The page shows the book, the resting orders, markouts, and whether we sat or pulled.

## Audience

1. People who watched [jev-trader](https://jev-trader.vercel.app/) and can tell a tape that holds a side from one that chatters.
2. People who click through and verify: dry-run badge, no wallet, simulated fills labeled **sim**, json schema, source.

Primary message: **the model is a sensor; the bot sits.**
Secondary: **markouts, not decisions-per-second.**

Nothing on screen may claim live on-chain fills while `dryRun` is true.

## Honesty (ship-blockers)

- If `dryRun` or `wallet == null`: header says **dry run**. Not a purple `jev-latest` badge pretending to be live.
- If `MODEL !== jev`: amber **stand-in**.
- Simulated fills: `simulated: true` in the payload **and** the word `sim` in the tape, always.
- Connecting state is **connecting**, never **LATE**. LATE is only `decision.late === true` after a real missed block.
- P&L in **USD** first, MON second. No −2733 MON theater on a $60 paper loss.
- Footer: experimental, paper trading unless a wallet is shown, not financial advice, model is not predicting 30s direction.

## Layout (desktop 16:9; mobile stacks)

1. **Header** — `sit`, live/connecting/reconnecting, block number, dry-run or truncated wallet (copy + explorer), model badge, uptime.
2. **Stats row** — last sensor latency, avg latency, quotes, fills, **fill rate** (fills/quotes), late blocks, **markout 10s (bps)**, P&L USD, gas USD (0 in dry-run), Jev/luna USD.
3. **Chart** — mid, resting bid/ask as thin rails if present, fill beads only on actual fills (sparse). Posture strip: both / bid / ask / pull / flatten / late. Persistence should be visible as runs of the same color, not a flicker.
4. **Sensor panel** — the signature, replacing their buy/sell bar:
   - Posture word: BOTH / BID / ASK / PULL / FLATTEN / SIT (hold) / LATE
   - Bars: toxic, stale, hold (noul 0–1)
   - Width ticks, size multiplier
   - Latency ms
5. **Standing quotes** — bid size @ price, ask size @ price, age in blocks, `status` (resting / sent / sim / none). If we sat this block: **sat**. If we sent: **requote**.
6. **Tape** — one row per block: posture, whether sent, fill if any, markout when known, tx or `sim`.
7. **Footer** — disclaimer + links (TypeSafe, Monad, Kuru, source).

## Motion

Something can change every ~300 ms (block, mid, latency) **without** the quote changing. Sitting is the content. Do not animate a requote that did not happen.

No blinking dots. Tabular numerals. Cheap transforms.

## Interactions

- Hover chart: block, mid, posture, quotes, fill, markout.
- Click tx/block: explorer (only real hashes).
- Click wallet: copy.
- Nothing else. No trading controls for viewers.

## States

| State | What the page shows |
|---|---|
| Connecting | “connecting”, empty chart, not LATE |
| Live dry-run | dry run badge, sim fills, sensors live |
| Live wallet | address, real tx hashes, gas accrues |
| Stand-in model | amber badge |
| Late | this block missed; previous quotes still described as resting if we did not pull |
| RPC down | reconnecting, chart frozen |
| Pulled | posture PULL, no resting sizes |

## Success vs jev-trader (the object, not the clap)

A stranger who watched both for 20 seconds can see:

1. Our quotes rest (same price for many blocks).
2. We sometimes **do not trade**.
3. Fills are rare relative to quotes.
4. Dry-run is obvious.
5. A markout number exists.

Numeric gates before Russell tweets (dry-run, last 2k decided blocks):

| Gate | Fail if |
|---|---|
| Posture lag-1 autocorr | < 0.5 |
| Mean same-posture run | < 8 blocks |
| Fill / quote | > 0.25 (paper maker that fills every time is still their bot) |
| `quote` present on decided non-pull blocks that sent or sat | missing field |
| UI `totals.fills` | `undefined` / 0 while json has fills |

## Non-goals (v1)

- Live size / real wallet
- User accounts
- Multiple markets (code may be market-address parameterized; UI is one)
- Perps, funding, CEX taker arb as a product
- Chat / Jev prose
- Dark-desk restyle for its own sake — cream/light like theirs is fine if the **data** is different; do not clone lying copy

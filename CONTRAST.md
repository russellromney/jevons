# Steal vs kill — jev-trader

Source: `https://github.com/jarrodwatts/jev-trader` (TypeScript, Bun, ethers v5, `@kuru-labs/kuru-sdk`).

## Steal (do not rewrite from scratch)

These are the only grown-up parts.

| Piece | File | Why |
|---|---|---|
| L2 `eth_call` decoder + optional vault merge | `src/book.ts` | One round trip, matches SDK formatting |
| Coalesced newHeads + 150 ms poll | `src/chain.ts` | Newest block only |
| `batchUpdate` post-only encode, local nonce, hardcoded gas limit | `src/market.ts` | Monad charges the **limit**; never `estimateGas` in the loop |
| Async receipts / lost after N blocks | `src/market.ts` `pollPending` | Fire-and-forget |
| Trade log decode (`Trade` event, maker fills) | `src/trades.ts` | Fills are **other people’s** txs |
| Bun.serve SSE shape | `src/server.ts` | snapshot / block / quote / fill / ping |
| Next app shell (card, tokens, SSE hook idea) | `web/` | Rebuild copy and panels; keep EventSource backoff |

Copy code, then delete their policy. Do not `git clone` as the repo root — new project named `sit`.

## Kill

| Thing | Why it is wrong |
|---|---|
| Choice `buy`/`sell` as the order | Classifier ≠ trader; 30s question, 300 ms life |
| Prompt: “IOC market order next block”, “crosses the spread” | Execution is post-only maker |
| Cancel+replace every block | Destroys queue, gas is the strategy |
| `decision.action = side` on cap | Silently fades the model |
| Mock `noise(block) * 3` on a logit | Forces chatter |
| Dry-run fill if any print **crosses** (touches) the price after 1 block | Optimistic; they fill ~100% of decisions |
| `upIn10` | Dead field |
| `appendFileSync` on the hot path | Use a buffered async writer |
| Frontend types with `quote`/`fills` vs live `trades === decisions` | Schema drift is how their UI lies |
| Empty state headline LATE | Connecting ≠ missed block |
| SPEC “confirmed in the same block” | Cannot wait for Proposed in 300 ms |
| `CLAUDE.md` “never decide every N blocks” | Sitting **is** deciding N blocks |

## Live opponent facts (as of 2026-09-17)

`GET https://jev-trader-production.up.railway.app/`

- `model: jev-latest`, `dryRun: true`, `wallet: null`
- Event keys: no `quote`, no `resting`
- `totals.trades === totals.decisions`
- Fill on every decided block, `simulated: true`, size 200
- Flip rate ~70%+, mean run ~1.4 blocks, max run 8
- `p(buy)` lag-1 autocorr negative
- `startedAt` 2026-09-17T02:02:29Z (process bounce they called a “fix”)

Your `/` must not be describable by that bullet list.

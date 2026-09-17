# sit

A market maker that sits.

Jev (or a cheap stand-in) is a **calibrated sensor**, not the trader. Code owns inventory, quotes, gas, and risk. The model answers toxic / stale / posture / hold. Quotes are two-sided, post-only, and stay on the book until the touch or a gate actually changes.

This folder is the handoff for a **new session that builds, deploys, and launches** the whole thing.

**Start here if you are the builder:** read [`SESSION.md`](SESSION.md) first, then the files it lists, then implement [`PLAN.md`](PLAN.md).

## Why this exists

[jev-trader](https://github.com/jarrodwatts/jev-trader) (Jarrod Watts / Monad) asks Jev buy-or-sell every 300 ms Monad block, cancels and replaces every block, and paper-fills 100% of decisions. Live `p(buy)` lag-1 autocorr is negative. The public Vercel UI expects a maker schema; Railway still emits a taker schema. The demo is a tweet metronome.

`sit` is the same arena (Kuru MON-USDC on Monad, Jev-class model, live dashboard) with a real maker loop.

## Docs

| File | What |
|---|---|
| [`SESSION.md`](SESSION.md) | Prompt / standing orders for the builder session |
| [`PLAN.md`](PLAN.md) | Ordered build: code → dry-run → Fly → Vercel → launch |
| [`SPEC.md`](SPEC.md) | Product, UI, honesty rules, success vs jev-trader |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Loop, layers, Avellaneda, fills, markouts |
| [`CONTRACT.md`](CONTRACT.md) | **One** wire schema. Frontend and backend import this. |
| [`QUESTIONS.md`](QUESTIONS.md) | Exact Jev/Luna questions |
| [`CONTRAST.md`](CONTRAST.md) | Steal vs kill from jev-trader |
| [`DEPLOY.md`](DEPLOY.md) | Fly.io bot + SSE, Vercel site |
| [`LAUNCH.md`](LAUNCH.md) | Go-live checklist and tweet |

## Run

```
source ~/.zshrc
cp .env.example .env
bun install
bun test
bun run start          # API :3000
# other terminal:
cd web && bun install && bun run dev   # UI :3001
```

Dry-run is the default. No `PRIVATE_KEY`. The bot reads the live Kuru book, posts simulated two-sided quotes, and fills only when a taker print trades **through** the quote.

## Non-negotiables

1. Jev never outputs the order. It outputs probabilities. Code maps them to quotes.
2. Two-sided post-only quotes. Replace only when the touch moves or a gate flips.
3. `hold` and `pull` are first-class. 0.51 is not a trade.
4. Dry-run is the default. Simulated fills are **through-price, queue-pessimistic**, never 100%.
5. One shared type module for the SSE payload. If `/` and the UI disagree, that is a ship-blocker.
6. No live size without two walk-forward days of non-negative pessimistic markouts after gas. Ask Russell before `DRY_RUN=false`.

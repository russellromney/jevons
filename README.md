# jevons

A dry-run MON directional-trading research system.

Jev is a **market-state sensor**, not the trader. Deterministic code selects a
strategy, verifies feed freshness and execution costs, controls risk, and emits
one paper instruction: buy, sell, or hold.

This folder is the handoff for a **new session that builds, deploys, and launches** the whole thing.

**Start here if you are the builder:** read [`SESSION.md`](SESSION.md) first, then the files it lists, then implement [`PLAN.md`](PLAN.md).

## Why this exists

[jev-trader](https://github.com/jarrodwatts/jev-trader) (Jarrod Watts / Monad) asks Jev buy-or-sell every 300 ms Monad block, cancels and replaces every block, and paper-fills 100% of decisions. Live `p(buy)` lag-1 autocorr is negative. The public Vercel UI expects a maker schema; Railway still emits a taker schema. The demo is a tweet metronome.

`jevons` uses Kuru MON-USDC plus a liquid MON futures reference. Its CEX-lag
engine trades only an **unabsorbed move**: reference return minus Kuru return
over the same one-second window, after round-trip costs. A static cross-venue
price difference is logged, but is not treated as directional alpha. It has
explicit hold paths for strategies whose liquidation or event inputs are not
yet available.

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

## Live (dry run)

- Dashboard: https://jevons.fly.dev/
- Snapshot JSON: https://jevons.fly.dev/snapshot
- Source: https://github.com/russellromney/sit

Vercel Next.js app is in `web/`. Deploy with `cd web && vercel --prod` after `vercel login`, env `NEXT_PUBLIC_API_URL=https://jevons.fly.dev`.

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

Dry-run is the default. No `PRIVATE_KEY`. The paper executor opens at the
executable Kuru touch plus configured slippage, reads the Kuru taker fee from
the live market parameters at startup, and exits at a stop, target, expiry, or
process loss limit.

## Non-negotiables

1. Jev never chooses the order side by itself. Code combines its gate with measured edge and costs.
2. `hold` is a first-class decision. Missing required data means hold.
3. The five engines are CEX lag, liquidation continuation, carry, event reaction, and mean reversion.
4. Strategies with unavailable inputs remain inactive and say why.
5. One directional event schema drives API, SSE, log, replay, and dashboard.
6. No live size. Ask Russell before any wallet or `DRY_RUN=false` work.

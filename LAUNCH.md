# Launch

Do not tweet until the object is true.

## Live (dry-run)

- API snapshot: https://jevons.fly.dev/snapshot
- Dashboard: https://jevons.fly.dev/
- Source: https://github.com/russellromney/sit
- Vercel: not needed; the dashboard is served by Fly.

## Gates

- [ ] Fly `GET /snapshot` matches the directional schema (script green)
- [ ] Dashboard shows **dry run**, selected strategy, action, paper position, and P&L
- [ ] Reference-feed freshness is visible and a missing required feed produces HOLD
- [ ] Replay contains enough captured events for a meaningful strategy comparison
- [ ] Vercel Next app — needs `vercel login` on this machine
- [x] Source public: https://github.com/russellromney/sit
- [x] No wallet, no “real trades” in the headline

## Tweet (draft — Russell edits)

Tone: the object, not a ratio. Do not call anyone a rube on the main post.

```
I built a dry-run MON strategy lab on Monad.

Jev is a fast market-state sensor. Code owns the strategy, expected-value gate, execution-cost model, exits, and paper P&L. Each selected strategy can buy, sell, or hold.

The dashboard shows required feeds and holds when they are absent. Dry run, no wallet, source in the repo.

sit → <vercel url>
```

Reply tweet (optional, technical):

```
The loop is not a language-model vote on direction. A deterministic trigger creates a candidate, Jev classifies its market state, and code accepts or rejects it after costs and risk.
```

## After launch

- Watch Fly logs for late streaks; if RPC dies, fix URL, do not tweet “fixed” without a new `startedAt` and a tape that sits.
- If someone says it alternates: **look at `/history` posture sequence** before replying.
- Swap `MODEL=luna` or `jev` via Fly secrets only after mock sits in production.

## Do not

- Claim live on-chain fills
- Claim alpha / profitable
- Deploy `PRIVATE_KEY` in the launch window
- Quiet-edit the tweet to “real trades”

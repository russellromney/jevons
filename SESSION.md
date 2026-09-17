# Builder session — start here

You are implementing **sit** from this folder. Russell wants the whole system built, dry-run deployed on **Fly.io**, website on **Vercel**, launched as a public honest demo that makes [jev-trader](https://jev-trader.vercel.app/) look like a costume.

You are not writing another design doc. You are shipping.

## Read in this order, then build

1. This file
2. `SPEC.md`
3. `CONTRAST.md` (what to copy from jev-trader, what to throw away)
4. `ARCHITECTURE.md`
5. `CONTRACT.md` (wire types — implement this first as `packages/types` or `src/types.ts` + `web/src/lib/types.ts` generated from one source)
6. `QUESTIONS.md`
7. `PLAN.md` (execution order)
8. `DEPLOY.md` and `LAUNCH.md` when code is dry-run green locally

Reference implementation to **steal execution from**, not strategy:

- Local clone if present, else `https://github.com/jarrodwatts/jev-trader`
- Hot path: `src/book.ts`, `src/chain.ts`, `src/market.ts` (batchUpdate post-only, hardcoded gas limit, fire-and-forget receipts)
- Do **not** copy `src/model.ts` QUESTIONS, `src/trader.ts` buy/sell-every-block, or the mock noise model

## Who Russell is / how to work

- Shell: `source ~/.zshrc` first. Use Bun. Machine has limited memory — no concurrent heavy builds.
- Secrets: `soup run -- <command>`. Never print secret values. Never commit `.env`.
- Do the work. Do not ask permission for local reversible choices. Ask before live trading, spending, or pushing to a public repo if one does not exist yet — **creating the GitHub repo and deploying dry-run is in scope** if `gh` is authenticated; still no `PRIVATE_KEY` on Fly unless Russell pastes it.
- Default `DRY_RUN=true`. Wallet stays unset until he says otherwise.
- Verify the website in a browser if browser tools exist: click, watch a few blocks, confirm schema fields render. Check desktop and mobile. If no browser tools, curl the Fly `/` and `/events` and say what you could not click.
- Match surrounding code once it exists. Short factual comments only for non-obvious constraints.

## Outcome that counts as done

- [ ] Repo at `~/Documents/Github/sit` with bot + Next.js dashboard, one shared event type
- [ ] Local dry-run: real Kuru book, mock or luna model, two-sided quotes, fills only on through-price, jsonl log, markouts
- [ ] Fly.io app streaming SSE (`/`, `/history`, `/events`)
- [ ] Vercel app pointed at that Fly URL, honest chrome: **dry run**, posture (not just buy/sell), resting bid+ask, markouts, P&L USD, late ≠ default
- [ ] `GET /` schema matches the UI types exactly (quote, resting, totals.fills, totals.quotes, markouts)
- [ ] README for humans (how to run, what the numbers mean)
- [ ] Launch checklist in `LAUNCH.md` ticked as far as deploy; tweet is drafted, Russell posts it

## Hard constraints (do not “simplify” these away)

- Do not ask Jev/Luna `buy` vs `sell` as the policy.
- Do not cancel+replace every block. Sit.
- Do not overwrite the model’s posture when the position cap hits. Flatten or quote the reducing side only.
- Do not simulate a fill just because you quoted. See `ARCHITECTURE.md` fills.
- Do not ship a frontend compiled against a different payload than Fly emits.
- Do not put `PRIVATE_KEY` in Vercel env. Bot-only, Fly secrets.
- Do not add a chat UI, user wallets, or a second market in v1.

## Model adapters (v1)

```
MODEL=mock | luna | jev
```

Same `questions` object for luna and jev. Mock is a **deterministic stand-in of the sensor bundle** (toxic from CVD+spread blowout, stale from a synthetic basis if no CEX feed, posture from inventory, hold from “touch unchanged”), not a random logit. No `Bun.sleep(80)` required; sleep only if you need to test late-path.

If `TYPESAFE_AI_API_KEY` is missing, do not fail the process — fall back to mock and badge **stand-in**. If luna key is missing, same.

Luna = cheap fast structured-output model Russell can call now (OpenAI-compatible JSON schema matching `QUESTIONS.md`). Adapter lives behind `src/model.ts`. Swap jev later without changing policy.

## Opponent (for the dashboard contrast, not for the tweet insult)

Live jev-trader backend: `https://jev-trader-production.up.railway.app/`
Site: `https://jev-trader.vercel.app/`
Repo: `https://github.com/jarrodwatts/jev-trader`

Their live `/` has no `quote`, `trades === decisions`, 100% simulated fills, dry-run, `startedAt` frozen at 2026-09-17T02:02:29Z. Your `/` must look like a maker.

## When stuck

Prefer a smaller correct loop over a pretty dashboard on a lying bot. If time is short: Fly SSE + a brutal honest one-screen UI beats a clone of their layout that still flips every block.

# Build plan

Do these in order. Do not start Vercel before Fly `/` matches `CONTRACT.md`.

## P0 — repo skeleton (hour 1)

- Init git in `~/Documents/Github/sit` (docs already here; do not delete them).
- Bun project, `src/`, `web/` Next.js (App Router, TS, CSS modules).
- Shared types: implement `CONTRACT.md` as `src/types.ts` and import in web via copy script `bun run sync-types` **or** a workspace package. Run it in `predev`/`prebuild`.
- `.env.example` (already in this folder — keep in sync).
- `.gitignore`: `.env`, `data/`, `web/.next`.
- Human `README.md` at repo root: keep the handoff README **and** add a `## Run` section (or merge run instructions into the existing README without deleting the handoff table).

## P1 — steal execution, no policy (hour 2–4)

Port `book.ts`, `chain.ts`, `market.ts`, `trades.ts` from jev-trader. Change `quotePrice` to return **both** sides from reservation, not one side inside the touch.

Scripts: `scripts/bench-read.ts`, `scripts/dry-encode.ts` (assert calldata vs SDK).

`Market.sendBoth(block, bid, ask, cancel)` → one `batchUpdate` with both arrays, `postOnly=true`.

## P2 — features + mock sensors + policy + loop (hour 4–8)

`features.ts`, `model.ts` (mock), `policy.ts`, `trader.ts`, `log.ts` (async append), `server.ts`, `index.ts`.

Unit tests: policy, fills, schema round-trip.

Local: `cp .env.example .env && bun install && bun run start`  
Watch logs: sits >> quotes, occasional FILL (sim), no BSBSBS posture tape.

**Gate:** 500 blocks local, mean posture run ≥ 8, fill/quote < 0.25, `/` JSON has `quote.status` resting most blocks.

## P3 — dashboard (hour 8–12)

Rebuild web against `CONTRACT.md`. Do not paste jev-trader copy (“STANDING ORDER / no abstaining / WHICH SIDE THIS BLOCK”).

Must show: dry run, posture, toxic/stale/hold, resting bid+ask, sat vs requote, markout, P&L USD, fill rate.

Connecting ≠ LATE.

`NEXT_PUBLIC_API_URL` default empty → same-origin in prod we will set to Fly.

## P4 — luna adapter (hour 12–14)

If keys exist in soup/env, `MODEL=luna`. Same questions. Timeout. Fallback mock.

If no keys: skip, mock is enough to deploy.

## P5 — Fly.io bot (hour 14–16)

See `DEPLOY.md`. Region close to Monad RPC if possible (`sjc` or `iad`). Volume for `data/events.jsonl`. Secrets: none required for dry-run besides optional model keys.

Curl `https://<app>.fly.dev/` — schema check script `scripts/check-schema.ts` that fetches `/` and asserts keys.

SSE from a browser or `curl -N /events` — snapshot then blocks.

## P6 — Vercel web (hour 16–18)

`web/` as the Vercel root. Env `NEXT_PUBLIC_API_URL=https://<app>.fly.dev`.

Browser: desktop + mobile. Watch 30s. Confirm sits. Confirm 0 fills in the header is **true** (quotes may be >0, fills rare) not `undefined`.

## P7 — jev adapter (if key)

`MODEL=jev`. Do not enable on Fly until mock/luna dry-run looks like a maker. Optional: Fly `MODEL=mock` first launch, swap luna/jev via `fly secrets` without a frontend change.

## P8 — launch

`LAUNCH.md`. Russell posts. Do not auto-tweet.

## Out of scope for this session

- Real `PRIVATE_KEY` / margin deposits
- CEX websocket (optional if easy: Binance `monusdt` or a proxy; if not, `refFeed: false`)
- Multi-market scanner
- Distilling a local model

## Definition of done (session)

Fly + Vercel live, dry-run, schema-honest, tape that sits, launch checklist filled through “deployed”, tweet drafted.

# Launch

Do not tweet until the object is true.

## Live (dry-run)

- API snapshot: https://sit-maker.fly.dev/snapshot
- Dashboard: https://sit-maker.fly.dev/
- Source: https://github.com/russellromney/sit
- Vercel: pending CLI login (`vercel login`), then `cd web && vercel --prod` with `NEXT_PUBLIC_API_URL=https://sit-maker.fly.dev`

## Gates

- [x] Fly `GET /snapshot` matches `CONTRACT.md` (script green)
- [x] Dashboard at https://sit-maker.fly.dev/ shows **dry run**, posture, resting bid and ask
- [x] Tape sits (sits >> quotes, fill rate ~4%, autocorr ~0.7)
- [x] Fill rate is a real number, not `undefined`
- [x] Connecting is “connecting”, not LATE
- [ ] Vercel Next app — needs `vercel login` on this machine
- [x] Source public: https://github.com/russellromney/sit
- [x] No wallet, no “real trades” in the headline

## Tweet (draft — Russell edits)

Tone: the object, not a ratio. Do not call anyone a rube on the main post.

```
I built a market maker on Monad that sits.

Jev (or a stand-in) does not pick buy/sell every block. It scores toxic / stale / hold. Code quotes both sides on Kuru and leaves the orders up until the book or a gate actually changes.

Fills are rare. Markouts are on the page. Dry run, paper fills, source in the repo.

sit → <vercel url>
```

Reply tweet (optional, technical):

```
The 300ms loop is for canceling a stale quote, not for flickering one.

Posture is both/bid/ask/pull/flatten. Sitting is the default. Sensors are noul+choice in one call.

If the tape alternates every block, the model is fitting last-print noise. Ours is gated on hold and inventory.
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

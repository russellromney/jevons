# Launch

Do not tweet until the object is true.

## Gates

- [ ] Fly `GET /` matches `CONTRACT.md` (script green)
- [ ] Vercel shows **dry run**, posture, resting bid and ask
- [ ] Watch 60 seconds: same quote prices for many blocks (SIT)
- [ ] Fill rate on the page is not ~100% and not a fake 0 from `undefined`
- [ ] Connecting refresh does not flash LATE
- [ ] Mobile 390px: numbers still readable
- [ ] Source repo public (if Russell agrees) with this handoff + human README
- [ ] No wallet, no “real trades” in the headline

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

# Directional trader execution plan

**Goal:** replace the inherited market-maker loop with a dry-run MON directional
trader. Every active strategy must return `buy`, `sell`, or `hold`; Jev is a
market-state sensor and deterministic code owns execution and risk.

**Non-negotiable:** no wallet, no private key, no live orders, and no claim that
an unavailable input feed is an edge.

## 1. Directional contract and loop

- [x] Replace maker postures and bid/ask quotes with one directional decision.
- [x] Define one event schema for API, SSE, logs, replay, and UI.
- [x] Include strategy, action, candidate reason, entry, exits, position, P&L,
  costs, and data-health in every event.

**Acceptance:** an event says exactly why it bought, sold, or held. It has no
resting-order fields and no simulated maker fill.

## 2. Normalized data feeds

- [x] Normalize Kuru book and trade data.
- [x] Add an off-hot-path MON reference-price and funding feed.
- [x] Surface freshness and missing feeds instead of inventing values.

**Acceptance:** a stale or absent reference, funding, liquidation, or event feed
blocks the strategy that requires it.

## 3. Five strategy engines

- [x] CEX-led Kuru lag reaction.
- [x] Liquidation / flow continuation.
- [x] Basis / funding carry.
- [x] Event reaction.
- [x] Regime-switching mean reversion.

**Acceptance:** each engine has an explicit trigger, required feed set, trade
horizon, invalidation, and hold path.

## 4. Jev gate

- [x] Ask small, candidate-specific state questions in parallel.
- [x] Use deterministic fallback when Jev is unavailable or times out.
- [x] Reject conflicting classifications.

**Acceptance:** Jev never chooses the side by itself; code combines its gate
with measurable edge, costs, freshness, and limits.

## 5. Paper execution and risk

- [x] Fill a directional paper order at the executable Kuru touch plus a
  conservative slippage assumption.
- [x] Track open position, realized/unrealized P&L, fees, stops, take-profit,
  expiry, and max loss.
- [x] Prohibit a new trade while a position is open unless it is an exit.

**Acceptance:** P&L is based on paper entry and exit prices, not a maker-fill
model or a decision counter.

## 6. Capture and replay

- [x] Append normalized state and decisions to JSONL asynchronously.
- [x] Add deterministic replay and summary metrics by strategy.
- [x] Compare Jev-gated results with a deterministic baseline.

**Acceptance:** replay reports trades, win rate, P&L, maximum drawdown, and
hold reasons from captured data without calling a model or venue.

## 7. Strategy-controlled dashboard

- [x] Add a dry-run endpoint for changing the active strategy.
- [x] Make the footer selector change the server-side paper engine.
- [x] Show only the selected engine's real position, P&L, block decisions,
  feed health, and trade history.

**Acceptance:** changing the footer updates the active strategy in the next SSE
event and the dashboard never labels maker telemetry as a directional result.

## Execution order

1. Contract, deterministic engine interface, and paper executor.
2. CEX reference feed and CEX lead-lag engine.
3. The remaining engines with explicit unavailable-feed holds.
4. Jev candidate gate.
5. Capture/replay.
6. Server endpoint, dashboard wiring, tests, Fly dry-run deployment.
7. Review every acceptance condition against the implementation.

## Execution record

Updated while work is performed. A checked item means code and a targeted test
exist, not merely a design discussion.

## Review against the plan — 2026-09-17

| Step | Result | Evidence |
|---|---|---|
| 1 | Complete | `DirectionalEvent` is served over snapshot/SSE; maker `quote` and `resting` are absent from the active process. |
| 2 | Complete with explicit limits | Kuru is live; Gate MON futures supplies reference and funding. Liquidation and event feeds are intentionally reported `missing`, never synthesized. |
| 3 | Complete | All five engine modules have trigger and hold paths. Only engines whose required feeds are live can form candidates. |
| 4 | Complete | Candidate-only Jev questions run in parallel, with deterministic fallback and strategy-specific rejection logic. |
| 5 | Complete | Paper entries use bid/ask plus slippage and fees; exits use stop, target, expiry, and max loss. No wallet path exists. |
| 6 | Complete | JSONL capture and `bun run replay` report actual versus deterministic-baseline P&L, drawdown, wins, losses, and Jev gate counts. Current sample has no qualifying trades, so both P&L values are honestly zero. |
| 7 | Complete | `POST /strategy` controls the active paper engine. Browser verification confirmed the footer selection updates the server loop and matching popup. |

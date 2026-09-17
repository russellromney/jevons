const url = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const required = ["block", "strategy", "mid", "bestBid", "bestAsk", "spreadBps", "reference", "feedHealth", "decision", "execution", "position", "portfolio", "totals"];
const totals = ["blocks", "decisions", "holds", "buys", "sells", "opened", "closed", "pnlUsd", "maxDrawdownUsd"];
const decision = ["strategy", "action", "reason", "candidate", "jev", "late"];
const execution = ["status", "action", "price", "size", "feeUsd", "slippageBps", "notionalUsd", "realizedPnlUsd", "simulated", "note"];

function fail(message: string): never { console.error(`schema fail: ${message}`); process.exit(1); }
const res = await fetch(`${url}/snapshot`).catch(() => fetch(url));
if (!res.ok) fail(`GET /snapshot ${res.status}`);
const snap = await res.json() as Record<string, unknown>;
if (snap.name !== "jevons") fail("name !== jevons");
if (snap.dryRun !== true || snap.wallet !== null) fail("must be dry-run with no wallet");
if (typeof snap.bankrollUsd !== "number") fail("bankrollUsd missing");
if (!Array.isArray(snap.strategies)) fail("strategies missing");
const latest = snap.latest as Record<string, unknown> | null;
if (!latest) { console.log("schema ok (no event yet)", url); process.exit(0); }
for (const key of required) if (!(key in latest)) fail(`latest missing ${key}`);
for (const key of totals) if (!(key in (latest.totals as Record<string, unknown>))) fail(`totals missing ${key}`);
for (const key of decision) if (!(key in (latest.decision as Record<string, unknown>))) fail(`decision missing ${key}`);
for (const key of execution) if (!(key in (latest.execution as Record<string, unknown>))) fail(`execution missing ${key}`);
if ((latest.execution as Record<string, unknown>).simulated !== true) fail("paper execution must be simulated");
console.log("schema ok", url, "strategy", latest.strategy, "action", (latest.decision as Record<string, unknown>).action, "pnl", (latest.totals as Record<string, unknown>).pnlUsd);

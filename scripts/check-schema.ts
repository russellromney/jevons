const url = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const requiredLatest = ["block", "mid", "bestBid", "bestAsk", "spreadBps", "microprice", "decision", "quote", "resting", "position", "totals"];
const requiredTotals = ["fills", "quotes", "sits", "pulls", "fillRate", "pnlUsd", "markout10Bps", "postureAutocorr"];
const requiredQuote = ["bid", "ask", "status", "sent"];
const requiredDecision = ["posture", "sensors", "late", "probabilities"];

function fail(msg: string): never {
  console.error("schema fail:", msg);
  process.exit(1);
}

const res = await fetch(url + "/snapshot").catch(() => fetch(url + "/"));
if (!res.ok) fail(`GET / ${res.status}`);
const snap = await res.json() as Record<string, unknown>;
if (snap.name !== "sit") fail("name !== sit");
if (typeof snap.dryRun !== "boolean") fail("dryRun");
if (typeof snap.startedAt !== "number") fail("startedAt");
const latest = snap.latest as Record<string, unknown> | null;
if (!latest) {
  console.log("schema ok (no latest yet)", url);
  process.exit(0);
}
for (const k of requiredLatest) if (!(k in latest)) fail(`latest missing ${k}`);
const totals = latest.totals as Record<string, unknown>;
for (const k of requiredTotals) if (!(k in totals)) fail(`totals missing ${k}`);
if (totals.fills === undefined) fail("fills undefined");
const quote = latest.quote as Record<string, unknown>;
for (const k of requiredQuote) if (!(k in quote)) fail(`quote missing ${k}`);
const decision = latest.decision as Record<string, unknown>;
for (const k of requiredDecision) if (!(k in decision)) fail(`decision missing ${k}`);
if (decision.late && decision.posture !== "late") fail("late posture");
console.log("schema ok", url, "posture", decision.posture, "sits", totals.sits, "quotes", totals.quotes, "fills", totals.fills);

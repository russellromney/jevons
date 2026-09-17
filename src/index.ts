import { config } from "./config";
import { startBlockFeed } from "./chain";
import { log10 } from "./book";
import { Market } from "./market";
import { Trader } from "./trader";
import { startServer } from "./server";

const market = new Market();
await market.init();

const startedAt = Date.now();
const meta = {
  name: "sit" as const,
  model: config.model === "jev" && config.typesafeKey ? config.jevModelId
    : config.model === "luna" && config.lunaApiKey ? (config.lunaModel ?? "luna")
    : "mock",
  wallet: market.address,
  dryRun: config.dryRun,
  market: config.market,
  marketName: "MON-USDC" as const,
  startedAt,
  refFeed: false,
};

const server = startServer(meta, () => trader.history);
const trader = new Trader(
  market,
  (e) => {
    server.broadcast(e);
    const d = e.decision;
    const q = e.quote;
    const sit = q.sent ? "REQUOTE" : q.status === "resting" ? "SIT" : q.status.toUpperCase();
    const sides = `${q.bid ? `bid ${q.bid.size}@${q.bid.price.toFixed(6)}` : "bid —"} ${q.ask ? `ask ${q.ask.size}@${q.ask.price.toFixed(6)}` : "ask —"}`;
    console.log(
      `#${e.block} ${e.mid.toFixed(6)} ${d.posture} t${(d.sensors.toxic * 100).toFixed(0)} h${(d.sensors.hold * 100).toFixed(0)} ${d.sensors.latencyMs}ms ${sit} ${sides} pnl $${e.totals.pnlUsd.toFixed(3)} sits ${e.totals.sits} quotes ${e.totals.quotes} fills ${e.totals.fills}`,
    );
  },
  (block, fill) => {
    server.broadcastFill(block, fill);
    console.log(`#${block} FILL ${fill.side} ${fill.size} @ ${fill.price.toFixed(6)}${fill.simulated ? " sim" : ` ${fill.txHash}`}`);
  },
  (block, quote) => {
    server.broadcastQuote(block, quote);
    if (quote.status !== "placed" && quote.status !== "sim" && quote.status !== "resting") {
      console.log(`#${block} ${quote.status.toUpperCase()} gas ${quote.gasMon.toFixed(6)} ${quote.txHash ?? ""}`);
    }
  },
);
trader.attachTradeFeed(log10(market.params.sizePrecision));

console.log(
  `sit · model=${trader.modelName} · two-sided post-only · sit-by-default · ${config.dryRun ? "DRY RUN" : `wallet ${market.address}`} · ${config.market} · :${config.port}`,
);
startBlockFeed((block) => trader.onHead(block));

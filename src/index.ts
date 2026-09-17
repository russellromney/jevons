import { config } from "./config";
import { startBlockFeed } from "./chain";
import { Market } from "./market";
import { startServer } from "./server";
import { DirectionalTrader } from "./directional/trader";
import type { DirectionalEvent } from "./directional/types";

const market = new Market();
await market.init();
const startedAt = Date.now();
let broadcast: (event: DirectionalEvent) => void = () => {};
const trader = new DirectionalTrader(market, (event) => broadcast(event));
const server = startServer({
  name: "jevons",
  model: trader.modelName,
  wallet: null,
  dryRun: true,
  market: config.market,
  marketName: "MON-USDC",
  bankrollUsd: config.bankrollUsd,
  startedAt,
  activeStrategy: trader.strategy,
  strategies: trader.strategies,
}, () => trader.history, { setStrategy: (value) => trader.setStrategy(value), activeStrategy: () => trader.strategy });
broadcast = server.broadcast;

await trader.start();
console.log(`jevons · directional paper trader · strategy=${trader.strategy} · model=${trader.modelName} · DRY RUN · :${config.port}`);
startBlockFeed((block) => trader.onHead(block));

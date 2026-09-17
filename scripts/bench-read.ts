import { Market } from "../src/market";

const n = Number(process.argv[2] ?? 20);
const market = new Market();
await market.init();
const times: number[] = [];
for (let i = 0; i < n; i++) {
  const t0 = performance.now();
  const book = await market.readBook();
  times.push(performance.now() - t0);
  if (i === 0) console.log(`mid ${book.mid} micro ${book.microprice} spread ${book.spreadBps.toFixed(2)}bps`);
}
times.sort((a, b) => a - b);
const mean = times.reduce((s, x) => s + x, 0) / times.length;
console.log(`n=${n} mean ${mean.toFixed(1)}ms p50 ${times[Math.floor(n / 2)]!.toFixed(1)}ms p90 ${times[Math.floor(n * 0.9)]!.toFixed(1)}ms`);

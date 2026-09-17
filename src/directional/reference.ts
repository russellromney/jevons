import { config } from "../config";
import type { FeedStatus, ReferencePrice } from "./types";

type BookTicker = { bidPrice?: string; askPrice?: string; highest_bid?: string; lowest_ask?: string; funding_rate?: string };
type Premium = { lastFundingRate?: string; funding_rate?: string };
const first = <T>(value: T | T[]) => Array.isArray(value) ? value[0] : value;

/**
 * A reference feed is deliberately off the Kuru block hot path. A failed poll
 * leaves a timestamped stale value; strategy code must then hold.
 */
export class ReferenceFeed {
  private current: ReferencePrice | null = null;
  private samples: { mid: number; updatedAt: number }[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: WebSocket | null = null;

  start() {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), config.referencePollMs);
    this.connect();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.timer = null;
    this.reconnectTimer = null;
    this.ws = null;
  }

  snapshot(): ReferencePrice | null {
    return this.current ? { ...this.current } : null;
  }

  status(now = Date.now()): FeedStatus {
    if (!this.current) return "missing";
    return now - this.current.updatedAt <= config.referenceStaleMs ? "live" : "stale";
  }

  private async refresh() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const [bookRes, fundingRes] = await Promise.allSettled([
        fetch(config.referenceUrl, { signal: AbortSignal.timeout(800) }),
        fetch(config.fundingUrl, { signal: AbortSignal.timeout(800) }),
      ]);
      const book = bookRes.status === "fulfilled" && bookRes.value.ok ? first(await bookRes.value.json() as BookTicker | BookTicker[]) : null;
      const bid = Number(book?.bidPrice ?? book?.highest_bid), ask = Number(book?.askPrice ?? book?.lowest_ask);
      const premium = fundingRes.status === "fulfilled" && fundingRes.value.ok ? first(await fundingRes.value.json() as Premium | Premium[]) : null;
      const funding = Number(premium?.lastFundingRate ?? premium?.funding_rate);
      if (bid > 0 && ask >= bid && this.status() !== "live") this.setPrice(bid, ask, "gate-futures-rest:MON_USDT");
      if (this.current) this.current = { ...this.current, fundingRate: Number.isFinite(funding) ? funding : null };
    } catch {
      // The last value becomes stale naturally. The decision engine will hold.
    } finally {
      this.inFlight = false;
    }
  }

  private connect() {
    try {
      const ws = new WebSocket(config.referenceWsUrl);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "futures.book_ticker", event: "subscribe", payload: ["MON_USDT"] }));
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { channel?: string; event?: string; result?: { b?: string; a?: string } };
          const bid = Number(message.result?.b), ask = Number(message.result?.a);
          if (message.channel === "futures.book_ticker" && message.event === "update" && bid > 0 && ask >= bid) this.setPrice(bid, ask, "gate-futures-ws:MON_USDT");
        } catch { /* Ignore malformed public-feed frames. */ }
      };
      const reconnect = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 2_000);
      };
      ws.onerror = reconnect;
      ws.onclose = reconnect;
    } catch {
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 2_000);
    }
  }

  private setPrice(bid: number, ask: number, source: string) {
    const updatedAt = Date.now();
    const mid = (bid + ask) / 2;
    this.samples.push({ mid, updatedAt });
    const oldest = updatedAt - Math.max(config.referenceReturnWindowMs * 3, 10_000);
    while (this.samples.length > 1 && this.samples[0]!.updatedAt < oldest) this.samples.shift();
    const prior = [...this.samples].reverse().find((sample) => sample.updatedAt <= updatedAt - config.referenceReturnWindowMs);
    const ret1Bps = prior ? ((mid - prior.mid) / prior.mid) * 10_000 : 0;
    this.current = { source, bid, ask, mid, ret1Bps, fundingRate: this.current?.fundingRate ?? null, updatedAt };
  }
}

"use client";

import { useEffect, useReducer } from "react";
import type { BlockEvent, ConnectionState, Fill, Meta, Quote } from "./types";

const CAP = 1000;
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 10_000;
const STALE_MS = 45_000;

export interface FeedState {
  meta: Meta | null;
  events: BlockEvent[];
  latest: BlockEvent | null;
  connection: ConnectionState;
}

type Action =
  | { type: "snapshot"; meta: Meta | null; history: BlockEvent[] }
  | { type: "block"; event: BlockEvent }
  | { type: "fill"; block: number; fill: Fill }
  | { type: "quote"; block: number; quote: Quote }
  | { type: "connection"; connection: ConnectionState };

const initial: FeedState = { meta: null, events: [], latest: null, connection: "connecting" };

function idx(events: BlockEvent[], block: number) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.block === block) return i;
  return -1;
}

function reducer(state: FeedState, action: Action): FeedState {
  switch (action.type) {
    case "connection":
      return state.connection === action.connection ? state : { ...state, connection: action.connection };
    case "snapshot": {
      const history = Array.isArray(action.history) ? action.history : [];
      const events = history.length > CAP ? history.slice(-CAP) : history;
      return { meta: action.meta ?? state.meta, events, latest: events.at(-1) ?? null, connection: "live" };
    }
    case "block": {
      const ev = action.event;
      if (!ev || typeof ev.block !== "number") return state;
      const prev = state.events;
      const last = prev.at(-1);
      if (last && ev.block <= last.block) {
        const i = idx(prev, ev.block);
        if (i < 0) return state;
        const events = prev.slice();
        events[i] = ev;
        return { ...state, events, latest: events.at(-1) ?? null };
      }
      let events = prev.concat(ev);
      if (events.length > CAP) events = events.slice(events.length - CAP);
      return { ...state, events, latest: ev };
    }
    case "fill": {
      const i = idx(state.events, action.block);
      if (i < 0) return state;
      const events = state.events.slice();
      const updated = { ...events[i]!, fill: action.fill };
      events[i] = updated;
      return { ...state, events, latest: i === events.length - 1 ? updated : state.latest };
    }
    case "quote": {
      const i = idx(state.events, action.block);
      if (i < 0) return state;
      const events = state.events.slice();
      const updated = { ...events[i]!, quote: action.quote };
      events[i] = updated;
      return { ...state, events, latest: i === events.length - 1 ? updated : state.latest };
    }
    default:
      return state;
  }
}

export function useFeed(apiUrl: string): FeedState {
  const [state, dispatch] = useReducer(reducer, initial);
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const base = (apiUrl || "").replace(/\/+$/, "");
    let closed = false;
    let attempt = 0;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stale: ReturnType<typeof setTimeout> | undefined;

    const arm = () => {
      if (stale) clearTimeout(stale);
      stale = setTimeout(() => { if (!closed) reconnect(); }, STALE_MS);
    };
    const teardown = () => {
      if (es) { es.onopen = null; es.onerror = null; es.close(); es = null; }
      if (stale) clearTimeout(stale);
    };
    const reconnect = () => {
      if (closed) return;
      teardown();
      dispatch({ type: "connection", connection: "reconnecting" });
      const delay = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** attempt);
      attempt++;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, delay);
    };
    const on = (type: string, fn: (data: unknown) => void) => {
      es?.addEventListener(type, (raw) => {
        arm();
        const payload = (raw as MessageEvent).data;
        if (typeof payload !== "string" || !payload) return;
        try { fn(JSON.parse(payload)); } catch { /* ignore */ }
      });
    };
    function connect() {
      if (closed) return;
      dispatch({ type: "connection", connection: attempt === 0 ? "connecting" : "reconnecting" });
      es = new EventSource(`${base}/events`);
      es.onopen = () => { attempt = 0; dispatch({ type: "connection", connection: "live" }); arm(); };
      es.onerror = () => { if (!closed) reconnect(); };
      on("snapshot", (data) => {
        const d = (data ?? {}) as Record<string, unknown>;
        dispatch({
          type: "snapshot",
          meta: {
            name: "sit",
            model: String(d.model ?? ""),
            wallet: typeof d.wallet === "string" ? d.wallet : null,
            dryRun: Boolean(d.dryRun),
            market: String(d.market ?? ""),
            marketName: "MON-USDC",
            startedAt: typeof d.startedAt === "number" ? d.startedAt : Date.now(),
            refFeed: Boolean(d.refFeed),
          },
          history: Array.isArray(d.history) ? (d.history as BlockEvent[]) : [],
        });
      });
      on("block", (data) => dispatch({ type: "block", event: data as BlockEvent }));
      on("fill", (data) => {
        const d = data as { block?: number; fill?: Fill };
        if (typeof d.block === "number" && d.fill) dispatch({ type: "fill", block: d.block, fill: d.fill });
      });
      on("quote", (data) => {
        const d = data as { block?: number; quote?: Quote };
        if (typeof d.block === "number" && d.quote) dispatch({ type: "quote", block: d.block, quote: d.quote });
      });
      on("ping", () => dispatch({ type: "connection", connection: "live" }));
    }
    connect();
    return () => { closed = true; if (retry) clearTimeout(retry); teardown(); };
  }, [apiUrl]);
  return state;
}

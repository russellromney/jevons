"use client";

import { useEffect, useState } from "react";
import { useFeed } from "@/lib/useFeed";
import { fmtInt, fmtPct01, fmtPrice, fmtUsd, shortAddr, uptime } from "@/lib/format";
import type { BlockEvent, Posture } from "@/lib/types";
import styles from "./page.module.css";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const POSTURE_COLOR: Record<Posture, string> = {
  both: "#5b6abf",
  bid_only: "#0fa968",
  ask_only: "#e4573d",
  pull: "#98968e",
  flatten: "#c98a1b",
  sit: "#5b6abf",
  late: "#c98a1b",
};

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div className={styles.barRow}>
      <span>{label}</span>
      <div className={styles.track}><div className={styles.fill} style={{ width: `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%` }} /></div>
      <span className="mono">{fmtPct01(v)}</span>
    </div>
  );
}

function Chart({ events }: { events: BlockEvent[] }) {
  const slice = events.slice(-120);
  return (
    <div className={styles.chart} aria-hidden>
      {slice.map((e) => (
        <div
          key={e.block}
          className={styles.cell}
          title={`#${e.block} ${e.decision.posture}`}
          style={{
            height: e.quote.sent ? "100%" : e.decision.posture === "late" ? "40%" : "70%",
            background: POSTURE_COLOR[e.decision.posture] ?? "#ddd",
            opacity: e.quote.sent ? 1 : 0.55,
          }}
        />
      ))}
    </div>
  );
}

export default function Page() {
  const feed = useFeed(API);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const e = feed.latest;
  const m = feed.meta;
  const connecting = feed.connection !== "live" && !e;
  const posture = connecting ? null : e?.decision.posture ?? null;
  const t = e?.totals;

  return (
    <main className="card">
      <header className={styles.header}>
        <h1 className={styles.title}>sit</h1>
        <span className={`${styles.dot} ${feed.connection === "live" ? styles.dotLive : styles.dotWait}`} />
        <span className="muted mono">{feed.connection}</span>
        {e && <span className="mono muted">block {fmtInt(e.block)}</span>}
        {m?.dryRun !== false && <span className={`${styles.badge} ${styles.dry}`}>dry run</span>}
        {m && <span className={`${styles.badge} ${styles.model}`}>{m.model || "mock"}</span>}
        {m?.wallet ? <span className="mono muted">{shortAddr(m.wallet)}</span> : <span className="muted">no wallet</span>}
        <span className="mono muted" style={{ marginLeft: "auto" }}>{uptime(m?.startedAt, now)}</span>
      </header>

      <div className={`${styles.stats} mono`}>
        <span>latency {e ? `${e.decision.sensors.latencyMs}ms` : "—"}</span>
        <span>{fmtInt(t?.quotes)} quotes</span>
        <span>{fmtInt(t?.sits)} sits</span>
        <span>{fmtInt(t?.fills)} fills</span>
        <span>fill rate {t ? fmtPct01(t.fillRate) : "—"}</span>
        <span>late {fmtInt(t?.lateBlocks)}</span>
        <span>markout10 {t?.markout10Bps == null ? "—" : `${t.markout10Bps.toFixed(2)} bps`}</span>
        <span className={t && t.pnlUsd < 0 ? "neg" : "pos"}>{t ? fmtUsd(t.pnlUsd) : "—"}</span>
        <span>autocorr {t?.postureAutocorr == null ? "—" : t.postureAutocorr.toFixed(2)}</span>
      </div>

      <div className={styles.main}>
        <section className={styles.panel}>
          <p className={styles.label}>posture this block</p>
          <p className={styles.posture} style={{ color: posture ? POSTURE_COLOR[posture] : "var(--muted)" }}>
            {connecting ? "connecting" : (posture ?? "—")}
          </p>
          <p className="muted">
            {connecting
              ? "waiting for the feed"
              : e?.quote.sent
                ? "requote — sent a batchUpdate"
                : e?.decision.posture === "pull"
                  ? "pulled — nothing resting"
                  : e?.decision.sensors.skipped
                    ? "sat — reused last sensors, no tx"
                    : "sat — quotes unchanged"}
          </p>
          {e && (
            <>
              <div className={styles.bars}>
                <Bar label="toxic" v={e.decision.sensors.toxic} />
                <Bar label="stale" v={e.decision.sensors.stale} />
                <Bar label="hold" v={e.decision.sensors.hold} />
              </div>
              <p className="muted mono">
                width +{e.decision.sensors.widthTicks} tick · size ×{e.decision.sensors.sizeMult} · {e.decision.sensors.regime}
                {e.decision.sensors.skipped ? " · skipped call" : ""}
              </p>
            </>
          )}
          <div className={styles.quotes}>
            <div className={styles.q}>
              <div className={styles.qName} style={{ color: "var(--buy)" }}>bid</div>
              <div className={`${styles.qPx} mono`}>{e?.quote.bid ? `${e.quote.bid.size} @ ${fmtPrice(e.quote.bid.price)}` : "—"}</div>
            </div>
            <div className={styles.q}>
              <div className={styles.qName} style={{ color: "var(--sell)" }}>ask</div>
              <div className={`${styles.qPx} mono`}>{e?.quote.ask ? `${e.quote.ask.size} @ ${fmtPrice(e.quote.ask.price)}` : "—"}</div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            mid {e ? fmtPrice(e.mid) : "—"} · spread {e ? `${e.spreadBps.toFixed(2)} bps` : "—"}
            {m && !m.refFeed ? " · no ref feed" : ""}
          </p>
        </section>

        <section className={styles.panel}>
          <p className={styles.label}>last 120 blocks — solid = sent, faded = sat</p>
          <Chart events={feed.events} />
          <p className={styles.label} style={{ marginTop: 16 }}>tape</p>
          <div className={`${styles.tape} mono`}>
            {connecting && <div className="muted">no blocks yet</div>}
            {[...feed.events].slice(-24).reverse().map((row) => (
              <div className={styles.row} key={row.block}>
                <span>{row.block}</span>
                <span style={{ color: POSTURE_COLOR[row.decision.posture] }}>{row.decision.posture}</span>
                <span>{row.quote.sent ? "requote" : row.quote.status}</span>
                <span>{row.fill ? `${row.fill.side}${row.fill.simulated ? " sim" : ""}` : ""}</span>
                <span>{row.decision.sensors.latencyMs}ms</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        Experimental paper market maker on Kuru MON-USDC / Monad. The model scores toxic / stale / hold;
        code quotes both sides and sits. Not financial advice.
        {m?.dryRun !== false ? " Dry run: simulated through-price fills only." : ""}{" "}
        <a href="https://github.com/russellromney/sit">source</a>
      </footer>
    </main>
  );
}

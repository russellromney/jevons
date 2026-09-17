function safe(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPrice(n: number | null | undefined): string {
  return safe(n).toFixed(6);
}

export function fmtUsd(n: number | null | undefined, d = 3): string {
  const v = safe(n);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(d)}`;
}

export function fmtPct01(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}

export function fmtSigned(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(d)}`;
}

export function hhmmss(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x: number) => (x < 10 ? `0${x}` : String(x));
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function uptime(startedAt: number | null | undefined, now = Date.now()): string {
  if (!startedAt || !Number.isFinite(startedAt)) return "00:00:00";
  return hhmmss(Math.max(0, now - startedAt));
}

export function shortAddr(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

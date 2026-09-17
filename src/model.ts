import { config } from "./config";
import { experimental_evaluate } from "ai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import type { Features } from "./features";
import type { Book } from "./book";
import type { TradeSummary } from "./trades";
import type { Posture, Sensors } from "./types";

export type Regime = Sensors["regime"];
export type ModelPosture = "both" | "bid_only" | "ask_only" | "pull" | "flatten";

export interface Answers {
  toxic: number;
  stale: number;
  hold: number;
  posture: ModelPosture;
  widthTicks: number;
  sizeMult: number;
  regime: Regime;
  probabilities: Record<string, number>;
  /** Per-question calibration confidence from Jev. Mock uses 1. */
  confidence: Record<string, number>;
  latencyMs: number;
  inputTokens: number;
  skipped: boolean;
}

export interface ModelState {
  market: "MON-USDC";
  block: number;
  blockMs: 300;
  mid: number;
  microprice: number;
  spreadBps: number;
  sigmaBlock: number;
  imbalance: number;
  depth: { "10bps": { bid: number; ask: number }; "25bps": { bid: number; ask: number } };
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string;
  trades: { count: number; buyMon: number; sellMon: number; cvdMon: number; lastSide: "buy" | "sell" | null };
  recentTrades: string[];
  inventoryMon: number;
  inventoryTarget: 0;
  resting: { bidMon: number; askMon: number; bidPx: number | null; askPx: number | null; ageBlocks: number };
  last: { posture: string; toxic: number; stale: number; hold: number; blocksSinceQuoteChange: number };
  basisBps: number | null;
  execution: {
    style: "two-sided post-only limit quotes on Kuru";
    life: "quotes rest until touch moves or a gate pulls; they are not IOC and do not cross";
    weEarn: "spread if a taker hits us; we pay gas only when we send";
  };
}

export interface Model {
  readonly name: string;
  decide(state: ModelState): Promise<Answers>;
}

const EXEC = {
  style: "two-sided post-only limit quotes on Kuru" as const,
  life: "quotes rest until touch moves or a gate pulls; they are not IOC and do not cross" as const,
  weEarn: "spread if a taker hits us; we pay gas only when we send" as const,
};

export function buildState(opts: {
  block: number;
  book: Book;
  feat: Features;
  trades: TradeSummary;
  recentTrades: string[];
  recentMids: number[];
  q: number;
  resting: ModelState["resting"];
  last: ModelState["last"];
}): ModelState {
  const { book, feat } = opts;
  const d10 = book.depthBps["10"] ?? { bid: 0, ask: 0 };
  const d25 = book.depthBps["25"] ?? { bid: 0, ask: 0 };
  return {
    market: "MON-USDC",
    block: opts.block,
    blockMs: 300,
    mid: feat.mid,
    microprice: feat.microprice,
    spreadBps: feat.spreadBps,
    sigmaBlock: feat.sigma,
    imbalance: feat.imbalance,
    depth: { "10bps": d10, "25bps": d25 },
    book: {
      bids: book.levels.bids.map(([p, s]) => `${p.toFixed(6)} x ${s.toFixed(1)}`),
      asks: book.levels.asks.map(([p, s]) => `${p.toFixed(6)} x ${s.toFixed(1)}`),
    },
    returnsBps: { last1: feat.ret1, last5: feat.ret5, last20: feat.ret20, last100: feat.ret100 },
    recentMids: opts.recentMids.map((m) => m.toFixed(6)).join(" "),
    trades: {
      count: opts.trades.count,
      buyMon: opts.trades.buyMon,
      sellMon: opts.trades.sellMon,
      cvdMon: opts.trades.cvdMon,
      lastSide: opts.trades.lastSide,
    },
    recentTrades: opts.recentTrades,
    inventoryMon: opts.q,
    inventoryTarget: 0,
    resting: opts.resting,
    last: opts.last,
    basisBps: feat.basisBps,
    execution: EXEC,
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clip01 = (x: number) => Math.min(1, Math.max(0, x));

export function mockAnswers(state: ModelState): Answers {
  const vol = state.trades.buyMon + state.trades.sellMon;
  const cvd = vol > 0 ? Math.abs(state.trades.cvdMon) / vol : 0;
  const toxic = clip01(sigmoid(cvd * 2.5 + (state.spreadBps > 10 ? 1.5 : 0) - 2.5));
  const stale = state.basisBps == null ? 0 : clip01(sigmoid(Math.abs(state.basisBps) / 2 - 1));
  const hold = state.last.blocksSinceQuoteChange > 0 && Math.abs(state.returnsBps.last1) < 1 && toxic < 0.4 ? 0.85 : 0.2;
  const max = config.maxPositionMon;
  const q = state.inventoryMon;
  let posture: ModelPosture = "both";
  if (toxic > 0.65) posture = "pull";
  else if (Math.abs(q) > 0.8 * max) posture = "flatten";
  else if (q < -0.4 * max) posture = "bid_only";
  else if (q > 0.4 * max) posture = "ask_only";
  const widthTicks = state.sigmaBlock > 0.0003 || toxic > 0.45 ? 2 : 0;
  const sizeMult = toxic > 0.65 ? 0 : 1;
  let regime: Regime = "quiet";
  if (posture === "pull" || toxic > 0.65) regime = "toxic";
  else if (stale > 0.65) regime = "stale_vs_cex";
  else if (Math.abs(state.returnsBps.last20) > 8) regime = "trend";
  else if (state.spreadBps > 12) regime = "event";
  const probabilities: Record<string, number> = { both: 0.2, bid_only: 0.1, ask_only: 0.1, pull: 0.1, flatten: 0.1 };
  probabilities[posture] = 0.7;
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(probabilities)) probabilities[k] = (probabilities[k] ?? 0) / sum;
  return {
    toxic, stale, hold, posture, widthTicks, sizeMult, regime, probabilities,
    latencyMs: 0, inputTokens: 0, skipped: false,
    confidence: { toxic: 1, stale: 1, hold: 1, posture: 1, width: 1, size: 1, regime: 1 },
  };
}

export class MockModel implements Model {
  readonly name = "mock";
  async decide(state: ModelState): Promise<Answers> {
    return mockAnswers(state);
  }
}

const LUNA_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "sit_sensors",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        toxic: { type: "number" },
        stale: { type: "number" },
        hold: { type: "number" },
        posture: { type: "string", enum: ["both", "bid_only", "ask_only", "pull", "flatten"] },
        width: { type: "number" },
        size: { type: "number" },
        regime: { type: "string", enum: ["quiet", "trend", "toxic", "event", "stale_vs_cex"] },
      },
      required: ["toxic", "stale", "hold", "posture", "width", "size", "regime"],
    },
  },
} as const;

function parseLuna(raw: unknown): Omit<Answers, "latencyMs" | "inputTokens" | "skipped" | "probabilities" | "confidence"> {
  const o = raw as Record<string, unknown>;
  const posture = (["both", "bid_only", "ask_only", "pull", "flatten"] as const).includes(o.posture as ModelPosture)
    ? (o.posture as ModelPosture) : "both";
  const regime = (["quiet", "trend", "toxic", "event", "stale_vs_cex"] as const).includes(o.regime as Regime)
    ? (o.regime as Regime) : "quiet";
  const width = Number(o.width) || 0;
  const size = Number(o.size) || 2;
  const sizeMult = size <= 0 ? 0 : size <= 1 ? 0.5 : size >= 3 ? 2 : 1;
  return {
    toxic: clip01(Number(o.toxic) || 0),
    stale: clip01(Number(o.stale) || 0),
    hold: clip01(Number(o.hold) || 0),
    posture,
    widthTicks: Math.max(0, Math.min(3, Math.round(width))),
    sizeMult,
    regime,
  };
}

export class LunaModel implements Model {
  readonly name = config.lunaModel ? `luna:${config.lunaModel}` : "luna";
  async decide(state: ModelState): Promise<Answers> {
    const t0 = Date.now();
    const url = (config.lunaBaseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.lunaApiKey}`,
        },
        body: JSON.stringify({
          model: config.lunaModel ?? "gpt-4.1-mini",
          temperature: 0,
          response_format: LUNA_SCHEMA,
          messages: [
            {
              role: "system",
              content: "You are a market-making sensor. Quotes are two-sided post-only limits that rest until the touch or a gate changes. They are not IOC and do not cross the spread. Return calibrated probabilities.",
            },
            { role: "user", content: JSON.stringify(state) },
          ],
        }),
        signal: controller.signal,
      });
      const json = await res.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number } };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      const parsed = parseLuna(JSON.parse(content));
      const probabilities: Record<string, number> = { both: 0.1, bid_only: 0.1, ask_only: 0.1, pull: 0.1, flatten: 0.1 };
      probabilities[parsed.posture] = 0.6;
      return { ...parsed, probabilities, confidence: {}, latencyMs: Date.now() - t0, inputTokens: json.usage?.prompt_tokens ?? 0, skipped: false };
    } finally {
      clearTimeout(timer);
    }
  }
}

const JEV_QUESTIONS = {
  toxic: {
    type: "boolean" as const,
    instructions: "Is adverse-selection risk high for a two-sided resting maker quote during the next ~10 seconds? True means a fill is likely to be followed by a mid-price move against us greater than half the spread.",
  },
  stale: {
    type: "boolean" as const,
    instructions: "Is Kuru's mid stale versus the reference mid in basisBps, creating a pickoff risk on the stale side this block?",
  },
  hold: {
    type: "boolean" as const,
    instructions: "Does the prior maker posture remain appropriate at this unchanged touch? True means leave resting quotes unchanged and do not spend gas to requote.",
  },
  posture: {
    type: "choice" as const,
    instructions: "Choose the safe quote posture for a two-sided post-only market maker. This is not a directional trade forecast.",
    criteria: {
      both: "Two-sided around reservation",
      bid_only: "Want to buy / reduce a short; no ask",
      ask_only: "Want to sell / reduce a long; no bid",
      pull: "Cancel everything; flow looks toxic or book broken",
      flatten: "Inventory too large; reducing side only",
    },
  },
  width: {
    type: "score" as const,
    instructions: "How many extra ticks should widen the half-spread for current conditions?",
    criteria: [
      "0 join the touch (quiet, two-way noise)",
      "1 +1 tick",
      "2 +2 ticks (elevated vol or mild toxic)",
      "3 +3 ticks or more (event / thin)",
    ],
  },
  size: {
    type: "score" as const,
    instructions: "What quote-size level is appropriate for the current maker risk?",
    criteria: ["0 none", "1 half", "2 full", "3 double — only if inventory is small and toxic is low"],
  },
  regime: {
    type: "choice" as const,
    instructions: "Classify the current market regime for the maker dashboard.",
    criteria: {
      quiet: "Two-way noise, sit tight",
      trend: "Directional tape",
      toxic: "Informed flow",
      event: "Wide spread / jumpy",
      stale_vs_cex: "On-chain lagging a reference",
    },
  },
};

export class JevModel implements Model {
  readonly name = config.jevModelId;
  async decide(state: ModelState): Promise<Answers> {
    const t0 = Date.now();
    const model = createTypeSafeAi({ apiKey: config.typesafeKey }).evaluationModel(config.jevModelId);
    const result = await experimental_evaluate({
      model,
      state: JSON.parse(JSON.stringify(state)),
      questions: JEV_QUESTIONS,
    });
    const answers = result.answers as Record<string, any>;
    const usage = result.usage;
    const confidence = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;
    const postureRaw = String(answers.posture?.choice ?? "both");
    const posture: ModelPosture = (["both", "bid_only", "ask_only", "pull", "flatten"] as const).includes(postureRaw as ModelPosture)
      ? postureRaw as ModelPosture : "both";
    const regimeRaw = String(answers.regime?.choice ?? "quiet");
    const regime: Regime = (["quiet", "trend", "toxic", "event", "stale_vs_cex"] as const).includes(regimeRaw as Regime)
      ? regimeRaw as Regime : "quiet";
    const widthScore = Number(answers.width?.score ?? 0);
    const sizeScore = Number(answers.size?.score ?? 2);
    const probabilities = (answers.posture?.probabilities ?? {}) as Record<string, number>;
    return {
      toxic: clip01(Number(answers.toxic?.probability ?? 0)),
      stale: clip01(Number(answers.stale?.probability ?? 0)),
      hold: clip01(Number(answers.hold?.probability ?? 0)),
      posture,
      widthTicks: Math.max(0, Math.min(3, Math.round(widthScore))),
      sizeMult: sizeScore <= 0 ? 0 : sizeScore <= 1 ? 0.5 : sizeScore >= 3 ? 2 : 1,
      regime,
      probabilities: Object.keys(probabilities).length ? probabilities : { [posture]: 1 },
      confidence,
      latencyMs: Date.now() - t0,
      inputTokens: usage?.inputTokens ?? 0,
      skipped: false,
    };
  }
}

export function createModel(): Model {
  if (config.model === "jev" && config.typesafeKey) return new JevModel();
  if (config.model === "luna" && config.lunaApiKey) return new LunaModel();
  return new MockModel();
}

export function withTimeout(model: Model, ms = 180): Model {
  return {
    name: model.name,
    async decide(state) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          model.decide(state),
          new Promise<Answers>((_, rej) => { timer = setTimeout(() => rej(new Error("model timeout")), ms); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

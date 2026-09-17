import { experimental_evaluate } from "ai";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { config } from "../config";
import type { Candidate, JevGate, ReferencePrice, StrategyId } from "./types";

interface GateState {
  strategy: StrategyId;
  candidate: Candidate;
  kuru: { mid: number; ret1Bps: number; ret5Bps: number; spreadBps: number; imbalance: number; cvdMon: number };
  reference: ReferencePrice | null;
}

const QUESTIONS = {
  continuation: { type: "boolean" as const, instructions: "Is the observed reference or flow impulse likely still continuing over the candidate horizon?" },
  exhaustion: { type: "boolean" as const, instructions: "Does the observed move show exhaustion or reversal risk over the candidate horizon?" },
  forcedFlow: { type: "boolean" as const, instructions: "Does the supplied flow state indicate forced liquidation-like execution rather than ordinary two-way trading?" },
  transientShock: { type: "boolean" as const, instructions: "Is the Kuru move likely a transient local liquidity shock rather than informed price discovery?" },
  eventMaterial: { type: "boolean" as const, instructions: "Does the supplied event state show a verified, material MON-specific event?" },
};

const value = (answers: Record<string, any>, key: string) => {
  const answer = answers[key];
  return Math.max(0, Math.min(1, Number(answer?.value ?? answer?.noul ?? answer?.probability ?? 0)));
};

function accept(strategy: StrategyId, gate: Omit<JevGate, "accepted" | "reason">): Pick<JevGate, "accepted" | "reason"> {
  if (strategy === "cex_lag" || strategy === "liquidation") {
    return gate.continuation >= 0.55 && gate.exhaustion <= 0.45
      ? { accepted: true, reason: "continuation accepted" }
      : { accepted: false, reason: "continuation gate rejected" };
  }
  if (strategy === "mean_reversion") {
    return gate.transientShock >= 0.55 && gate.continuation <= 0.45
      ? { accepted: true, reason: "transient-shock gate accepted" }
      : { accepted: false, reason: "mean-reversion gate rejected" };
  }
  if (strategy === "event") {
    return gate.eventMaterial >= 0.6 ? { accepted: true, reason: "event gate accepted" } : { accepted: false, reason: "event gate rejected" };
  }
  return gate.exhaustion <= 0.45 ? { accepted: true, reason: "venue-risk gate accepted" } : { accepted: false, reason: "venue-risk gate rejected" };
}

function deterministic(state: GateState): JevGate {
  const continuation = state.reference && Math.abs(state.reference.ret1Bps) >= 2 ? 0.7 : 0.35;
  const exhaustion = Math.abs(state.kuru.ret1Bps) > 30 ? 0.65 : 0.2;
  const transientShock = Math.abs(state.kuru.ret1Bps) > 8 && (!state.reference || Math.abs(state.reference.ret1Bps) < 2) ? 0.75 : 0.2;
  const base = { used: false, latencyMs: 0, continuation, exhaustion, forcedFlow: 0, transientShock, eventMaterial: 0 };
  return { ...base, ...accept(state.strategy, base) };
}

export async function classifyCandidate(state: GateState): Promise<JevGate> {
  if (config.model !== "jev" || !config.typesafeKey) return deterministic(state);
  const t0 = Date.now();
  try {
    const model = createTypeSafeAi({ apiKey: config.typesafeKey }).evaluationModel(config.jevModelId);
    const result = await experimental_evaluate({ model, state: JSON.parse(JSON.stringify(state)), questions: QUESTIONS });
    const answers = result.answers as Record<string, any>;
    const base = {
      used: true, latencyMs: Date.now() - t0,
      continuation: value(answers, "continuation"), exhaustion: value(answers, "exhaustion"),
      forcedFlow: value(answers, "forcedFlow"), transientShock: value(answers, "transientShock"), eventMaterial: value(answers, "eventMaterial"),
    };
    return { ...base, ...accept(state.strategy, base) };
  } catch {
    return deterministic(state);
  }
}

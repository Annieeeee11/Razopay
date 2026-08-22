import type { AmbiguousCandidate } from "../../data/types.js";

export interface LlmVerdict {
  verdict: "match" | "no_match" | "unsure";
  reasoning: string;
  /** For split ambiguity: which settlement IDs form the true batch. */
  chosenSettlementIds?: string[];
}

export interface LlmProvider {
  name: string;
  resolve(pair: AmbiguousCandidate): Promise<LlmVerdict>;
}

export function parseVerdictJson(text: string): LlmVerdict {
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    return { verdict: "unsure", reasoning: "LLM returned non-JSON response" };
  }
  try {
    const parsed = JSON.parse(
      trimmed.slice(jsonStart, jsonEnd + 1),
    ) as Partial<LlmVerdict>;
    const verdict = parsed.verdict;
    if (verdict !== "match" && verdict !== "no_match" && verdict !== "unsure") {
      return { verdict: "unsure", reasoning: "LLM verdict unparseable" };
    }
    const chosen = Array.isArray(parsed.chosenSettlementIds)
      ? parsed.chosenSettlementIds.filter((id): id is string => typeof id === "string")
      : undefined;
    return {
      verdict,
      reasoning: parsed.reasoning?.trim() || "LLM provided no reasoning",
      chosenSettlementIds: chosen && chosen.length > 0 ? chosen : undefined,
    };
  } catch {
    return { verdict: "unsure", reasoning: "LLM returned invalid JSON" };
  }
}

export const SETTLEMENT_SYSTEM_PROMPT = `You are a payment gateway settlement reconciliation assistant. Given one bank payout credit and one settlement record (plus optional rival settlements or split combination options), decide if they represent the same underlying payout (matched on UTR / net amount).
Bank-feed UTRs are often truncated prefixes of the settlement UTR — judge on the shared prefix when it is long enough, not full-string equality.
When "rivals" are present, return "match" only if the primary settlement is the best fit among primary+rivals; otherwise return "no_match" or "unsure".
When "splitOptions" are present, pick which combination (if any) is the true batch and include "chosenSettlementIds" with those settlement IDs on a match verdict.
Respond with ONLY valid JSON: {"verdict":"match"|"no_match"|"unsure","reasoning":"<one short sentence>","chosenSettlementIds":["setl_..."]}.
Omit chosenSettlementIds unless verdict is "match" for a split case.
Use "unsure" when evidence is insufficient — do not force a match.`;

/** Build the user JSON payload shared by all LLM providers. */
export function buildResolvePayload(pair: AmbiguousCandidate): string {
  const payload: Record<string, unknown> = {
    bankCredit: pair.bank,
    settlement: pair.settlement,
    deterministicScore: pair.score,
    deterministicReason: pair.reasoning,
  };
  if (pair.kind) payload.kind = pair.kind;
  if (pair.rivals && pair.rivals.length > 0) {
    payload.rivals = pair.rivals.map((r) => ({
      settlement: r.settlement,
      score: r.score,
      reason: r.reasoning,
    }));
  }
  if (pair.splitOptions && pair.splitOptions.length > 0) {
    payload.splitOptions = pair.splitOptions;
  }
  return JSON.stringify(payload, null, 2);
}

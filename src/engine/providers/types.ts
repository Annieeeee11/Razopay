import type { AmbiguousCandidate } from "../../data/types.js";

export interface LlmVerdict {
  verdict: "match" | "no_match" | "unsure";
  reasoning: string;
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
    return {
      verdict,
      reasoning: parsed.reasoning?.trim() || "LLM provided no reasoning",
    };
  } catch {
    return { verdict: "unsure", reasoning: "LLM returned invalid JSON" };
  }
}

export const SETTLEMENT_SYSTEM_PROMPT = `You are a payment gateway settlement reconciliation assistant. Given one bank payout credit and one settlement record, decide if they represent the same underlying payout (matched on UTR / net amount).
Respond with ONLY valid JSON: {"verdict":"match"|"no_match"|"unsure","reasoning":"<one short sentence>"}.
Use "unsure" when evidence is insufficient — do not force a match.`;

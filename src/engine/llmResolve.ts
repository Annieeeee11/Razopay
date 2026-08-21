import Anthropic from "@anthropic-ai/sdk";
import type {
  AmbiguousCandidate,
  Exception,
  MatchResult,
} from "../data/types.js";

export interface LlmResolveResult {
  matches: MatchResult[];
  exceptions: Exception[];
  enabled: boolean;
  providerName: string;
}

interface LlmVerdict {
  verdict: "match" | "no_match" | "unsure";
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a payment gateway settlement reconciliation assistant. Given one bank payout credit and one settlement record, decide if they represent the same underlying payout (matched on UTR / net amount).
Respond with ONLY valid JSON: {"verdict":"match"|"no_match"|"unsure","reasoning":"<one short sentence>"}.
Use "unsure" when evidence is insufficient — do not force a match.`;

function parseVerdict(text: string): LlmVerdict {
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

/**
 * Phase 1 LLM pass (Anthropic only). Phase 2 adds provider interface.
 */
export async function llmResolve(
  ambiguous: AmbiguousCandidate[],
  options: { skipLlm?: boolean } = {},
): Promise<LlmResolveResult> {
  const matches: MatchResult[] = [];
  const exceptions: Exception[] = [];

  if (ambiguous.length === 0) {
    return { matches, exceptions, enabled: false, providerName: "none" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (options.skipLlm || !apiKey) {
    for (const a of ambiguous) {
      exceptions.push({
        recordId: a.bank.id,
        source: "bank",
        reason: "ambiguous — LLM unavailable",
      });
      exceptions.push({
        recordId: a.settlement.settlementId,
        source: "settlement",
        reason: "ambiguous — LLM unavailable",
      });
    }
    return { matches, exceptions, enabled: false, providerName: "none" };
  }

  console.log(
    `LLM pass: ${ambiguous.length} ambiguous pairs, provider=anthropic, est. calls=${ambiguous.length}`,
  );

  const client = new Anthropic({ apiKey });

  for (const a of ambiguous) {
    const userContent = JSON.stringify(
      {
        bankCredit: a.bank,
        settlement: a.settlement,
        deterministicScore: a.score,
        deterministicReason: a.reasoning,
      },
      null,
      2,
    );

    try {
      const response = await client.messages.create({
        model: "claude-3-5-haiku-latest",
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const verdict = parseVerdict(text);

      if (verdict.verdict === "match") {
        matches.push({
          bankCreditId: a.bank.id,
          settlementId: a.settlement.settlementId,
          confidence: Math.max(a.score, 0.8),
          matchedBy: "llm",
          reasoning: `LLM verdict: match — ${verdict.reasoning}`,
        });
      } else if (verdict.verdict === "no_match") {
        exceptions.push({
          recordId: a.bank.id,
          source: "bank",
          reason: `LLM verdict: no_match — ${verdict.reasoning}`,
        });
        exceptions.push({
          recordId: a.settlement.settlementId,
          source: "settlement",
          reason: `LLM verdict: no_match — ${verdict.reasoning}`,
        });
      } else {
        exceptions.push({
          recordId: a.bank.id,
          source: "bank",
          reason: `LLM verdict: unsure — ${verdict.reasoning}`,
        });
        exceptions.push({
          recordId: a.settlement.settlementId,
          source: "settlement",
          reason: `LLM verdict: unsure — ${verdict.reasoning}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      exceptions.push({
        recordId: a.bank.id,
        source: "bank",
        reason: `ambiguous — LLM error: ${msg}`,
      });
      exceptions.push({
        recordId: a.settlement.settlementId,
        source: "settlement",
        reason: `ambiguous — LLM error: ${msg}`,
      });
    }
  }

  return { matches, exceptions, enabled: true, providerName: "anthropic" };
}

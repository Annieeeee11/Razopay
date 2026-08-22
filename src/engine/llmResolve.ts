import type {
  AmbiguousCandidate,
  Exception,
  MatchResult,
} from "../data/types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { isOllamaReachable, OllamaProvider } from "./providers/ollama.js";
import type { LlmProvider } from "./providers/types.js";

export interface LlmResolveResult {
  matches: MatchResult[];
  exceptions: Exception[];
  enabled: boolean;
  providerName: string;
}

export type LlmProviderChoice = "anthropic" | "ollama" | "none";

export async function selectLlmProvider(options: {
  skipLlm?: boolean;
  llmProvider?: LlmProviderChoice;
  llmModel?: string;
  seed?: number;
}): Promise<{ provider: LlmProvider | null; name: string }> {
  if (options.skipLlm || options.llmProvider === "none") {
    return { provider: null, name: "none" };
  }

  const seed = options.seed ?? 42;

  if (options.llmProvider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.warn("Requested anthropic provider but ANTHROPIC_API_KEY missing.");
      return { provider: null, name: "none" };
    }
    return { provider: new AnthropicProvider(key), name: "anthropic" };
  }

  if (options.llmProvider === "ollama") {
    if (!(await isOllamaReachable())) {
      console.warn("Requested ollama provider but localhost:11434 unreachable.");
      return { provider: null, name: "none" };
    }
    return {
      provider: new OllamaProvider(options.llmModel ?? "llama3.2", undefined, seed),
      name: "ollama",
    };
  }

  // Auto-select: Anthropic key > Ollama reachable > none
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    return { provider: new AnthropicProvider(key), name: "anthropic" };
  }
  if (await isOllamaReachable()) {
    return {
      provider: new OllamaProvider(options.llmModel ?? "llama3.2", undefined, seed),
      name: "ollama",
    };
  }
  return { provider: null, name: "none" };
}

function optionSetKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

function isValidSplitChoice(
  chosen: string[] | undefined,
  options: string[][],
): chosen is string[] {
  if (!chosen || chosen.length < 2) return false;
  const key = optionSetKey(chosen);
  return options.some((opt) => optionSetKey(opt) === key);
}

function pushPairExceptions(
  exceptions: Exception[],
  bankId: string,
  settlementId: string,
  reason: string,
  relatedExtra: string[] = [],
): void {
  const bankRelated = [settlementId, ...relatedExtra];
  const setlRelated = [bankId, ...relatedExtra];
  exceptions.push({
    recordId: bankId,
    source: "bank",
    reason,
    relatedIds: bankRelated,
  });
  exceptions.push({
    recordId: settlementId,
    source: "settlement",
    reason,
    relatedIds: setlRelated,
  });
}

/**
 * Resolve only the ambiguous bucket via the selected LLM provider.
 */
export async function llmResolve(
  ambiguous: AmbiguousCandidate[],
  options: {
    skipLlm?: boolean;
    llmProvider?: LlmProviderChoice;
    llmModel?: string;
    seed?: number;
  } = {},
): Promise<LlmResolveResult> {
  const matches: MatchResult[] = [];
  const exceptions: Exception[] = [];

  if (ambiguous.length === 0) {
    return { matches, exceptions, enabled: false, providerName: "none" };
  }

  const { provider, name } = await selectLlmProvider(options);

  console.log(
    `LLM pass: ${ambiguous.length} ambiguous pairs, provider=${name}, est. calls=${ambiguous.length}`,
  );

  if (!provider) {
    for (const a of ambiguous) {
      if (a.kind === "split" && a.splitOptions) {
        const allIds = [...new Set(a.splitOptions.flat())];
        exceptions.push({
          recordId: a.bank.id,
          source: "bank",
          reason: `ambiguous split — LLM unavailable: ${a.reasoning}`,
          exceptionType: "batched_payout",
          relatedIds: allIds,
        });
      } else {
        pushPairExceptions(
          exceptions,
          a.bank.id,
          a.settlement.settlementId,
          "ambiguous — LLM unavailable",
          a.rivals?.map((r) => r.settlement.settlementId) ?? [],
        );
      }
    }
    return { matches, exceptions, enabled: false, providerName: "none" };
  }

  for (const a of ambiguous) {
    try {
      const verdict = await provider.resolve(a);
      const isSplit = a.kind === "split" && Boolean(a.splitOptions?.length);

      if (verdict.verdict === "match") {
        if (isSplit && a.splitOptions) {
          if (isValidSplitChoice(verdict.chosenSettlementIds, a.splitOptions)) {
            const components = [...verdict.chosenSettlementIds].sort();
            matches.push({
              bankCreditId: a.bank.id,
              settlementId: components[0]!,
              components,
              confidence: Math.max(a.score, 0.8),
              matchedBy: "llm",
              reasoning: `LLM verdict: match (split) — ${verdict.reasoning}`,
            });
          } else {
            const allIds = [...new Set(a.splitOptions.flat())];
            exceptions.push({
              recordId: a.bank.id,
              source: "bank",
              reason: `LLM verdict: match but invalid/missing chosenSettlementIds — ${verdict.reasoning}`,
              exceptionType: "batched_payout",
              relatedIds: allIds,
            });
          }
        } else {
          matches.push({
            bankCreditId: a.bank.id,
            settlementId: a.settlement.settlementId,
            confidence: Math.max(a.score, 0.8),
            matchedBy: "llm",
            reasoning: `LLM verdict: match — ${verdict.reasoning}`,
          });
        }
      } else if (verdict.verdict === "no_match") {
        if (isSplit && a.splitOptions) {
          const allIds = [...new Set(a.splitOptions.flat())];
          exceptions.push({
            recordId: a.bank.id,
            source: "bank",
            reason: `LLM verdict: no_match (split) — ${verdict.reasoning}`,
            exceptionType: "batched_payout",
            relatedIds: allIds,
          });
        } else {
          pushPairExceptions(
            exceptions,
            a.bank.id,
            a.settlement.settlementId,
            `LLM verdict: no_match — ${verdict.reasoning}`,
            a.rivals?.map((r) => r.settlement.settlementId) ?? [],
          );
        }
      } else {
        if (isSplit && a.splitOptions) {
          const allIds = [...new Set(a.splitOptions.flat())];
          exceptions.push({
            recordId: a.bank.id,
            source: "bank",
            reason: `LLM verdict: unsure (split) — ${verdict.reasoning}`,
            exceptionType: "batched_payout",
            relatedIds: allIds,
          });
        } else {
          pushPairExceptions(
            exceptions,
            a.bank.id,
            a.settlement.settlementId,
            `LLM verdict: unsure — ${verdict.reasoning}`,
            a.rivals?.map((r) => r.settlement.settlementId) ?? [],
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      if (a.kind === "split" && a.splitOptions) {
        const allIds = [...new Set(a.splitOptions.flat())];
        exceptions.push({
          recordId: a.bank.id,
          source: "bank",
          reason: `ambiguous — LLM error: ${msg}`,
          exceptionType: "batched_payout",
          relatedIds: allIds,
        });
      } else {
        pushPairExceptions(
          exceptions,
          a.bank.id,
          a.settlement.settlementId,
          `ambiguous — LLM error: ${msg}`,
        );
      }
    }
  }

  return { matches, exceptions, enabled: true, providerName: name };
}

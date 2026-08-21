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
}): Promise<{ provider: LlmProvider | null; name: string }> {
  if (options.skipLlm || options.llmProvider === "none") {
    return { provider: null, name: "none" };
  }

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
      provider: new OllamaProvider(options.llmModel ?? "llama3.2"),
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
      provider: new OllamaProvider(options.llmModel ?? "llama3.2"),
      name: "ollama",
    };
  }
  return { provider: null, name: "none" };
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

  for (const a of ambiguous) {
    try {
      const verdict = await provider.resolve(a);

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

  return { matches, exceptions, enabled: true, providerName: name };
}

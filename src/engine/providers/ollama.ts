import type { AmbiguousCandidate } from "../../data/types.js";
import {
  buildResolvePayload,
  parseVerdictJson,
  SETTLEMENT_SYSTEM_PROMPT,
  type LlmProvider,
  type LlmVerdict,
} from "./types.js";

const DEFAULT_HOST = "http://localhost:11434";

export async function isOllamaReachable(
  host = DEFAULT_HOST,
  timeoutMs = 800,
): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${host}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export class OllamaProvider implements LlmProvider {
  name = "ollama";
  private host: string;
  private model: string;
  private seed: number;

  constructor(model = "llama3.2", host = DEFAULT_HOST, seed = 42) {
    this.model = model;
    this.host = host;
    this.seed = seed;
  }

  async resolve(pair: AmbiguousCandidate): Promise<LlmVerdict> {
    const userContent = buildResolvePayload(pair);

    const res = await fetch(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: { temperature: 0, seed: this.seed },
        messages: [
          { role: "system", content: SETTLEMENT_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      return {
        verdict: "unsure",
        reasoning: `Ollama HTTP ${res.status}`,
      };
    }

    const body = (await res.json()) as {
      message?: { content?: string };
    };
    return parseVerdictJson(body.message?.content ?? "");
  }
}

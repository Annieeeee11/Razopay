import Anthropic from "@anthropic-ai/sdk";
import type { AmbiguousCandidate } from "../../data/types.js";
import {
  parseVerdictJson,
  SETTLEMENT_SYSTEM_PROMPT,
  type LlmProvider,
  type LlmVerdict,
} from "./types.js";

export class AnthropicProvider implements LlmProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async resolve(pair: AmbiguousCandidate): Promise<LlmVerdict> {
    const userContent = JSON.stringify(
      {
        bankCredit: pair.bank,
        settlement: pair.settlement,
        deterministicScore: pair.score,
        deterministicReason: pair.reasoning,
      },
      null,
      2,
    );

    const response = await this.client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 200,
      system: SETTLEMENT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseVerdictJson(text);
  }
}

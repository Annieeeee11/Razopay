#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAndWrite } from "./data/generate.js";
import type { ReconcileConfig } from "./data/types.js";
import {
  loadCorrections,
  suggestFuzzyThreshold,
} from "./engine/corrections.js";
import { reconcile } from "./engine/reconcile.js";
import type { LlmProviderChoice } from "./engine/llmResolve.js";
import { scoreAgainstGroundTruth } from "./scoring/metrics.js";
import {
  KNOWN_LIMITATIONS,
  writeReport,
  type FullReport,
} from "./scoring/report.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]): {
  seed: number;
  generateOnly: boolean;
  skipLlm: boolean;
  llmProvider?: LlmProviderChoice;
  llmModel: string;
  applyCorrections: boolean;
} {
  let seed = 42;
  let generateOnly = false;
  let skipLlm = false;
  let llmProvider: LlmProviderChoice | undefined;
  let llmModel = "llama3.2";
  let applyCorrections = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed") {
      const next = argv[++i];
      if (!next || Number.isNaN(Number(next))) {
        throw new Error("--seed requires a numeric value");
      }
      seed = Number(next);
    } else if (arg?.startsWith("--seed=")) {
      seed = Number(arg.slice("--seed=".length));
      if (Number.isNaN(seed)) throw new Error("--seed requires a numeric value");
    } else if (arg === "--generate-only") {
      generateOnly = true;
    } else if (arg === "--skip-llm") {
      skipLlm = true;
      llmProvider = "none";
    } else if (arg === "--llm-provider") {
      const next = argv[++i];
      if (next !== "anthropic" && next !== "ollama" && next !== "none") {
        throw new Error("--llm-provider must be anthropic|ollama|none");
      }
      llmProvider = next;
    } else if (arg === "--llm-model") {
      const next = argv[++i];
      if (!next) throw new Error("--llm-model requires a value");
      llmModel = next;
    } else if (arg === "--apply-corrections") {
      applyCorrections = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { seed, generateOnly, skipLlm, llmProvider, llmModel, applyCorrections };
}

function printHelp(): void {
  console.log(`Usage: npm run reconcile -- [options]

Razorpay-style payment gateway settlement reconciliation
(Payment → Settlement → Bank payout credit via UTR).

Options:
  --seed <n>                      Seeded RNG (default: 42)
  --generate-only                 Write data/*.json and exit
  --skip-llm                      Force no LLM (same as --llm-provider none)
  --llm-provider <anthropic|ollama|none>
                                  Explicit provider (else: API key → Ollama → none)
  --llm-model <name>              Ollama model (default: llama3.2)
  --apply-corrections             Apply output/corrections.json overrides
  -h, --help                      Show help
`);
}

function copyReportToDashboard(jsonPath: string): void {
  const destDir = join(ROOT, "dashboard", "public");
  if (!existsSync(join(ROOT, "dashboard"))) return;
  mkdirSync(destDir, { recursive: true });
  copyFileSync(jsonPath, join(destDir, "report.json"));
}

async function main(): Promise<void> {
  const {
    seed,
    generateOnly,
    skipLlm,
    llmProvider,
    llmModel,
    applyCorrections,
  } = parseArgs(process.argv.slice(2));

  console.log(`Generating synthetic settlement dataset (seed=${seed})...`);
  const dataset = generateAndWrite(seed);
  console.log(
    `Wrote ${dataset.payments.length} payments, ${dataset.settlements.length} settlements, ${dataset.bankCredits.length} bank credits, ${dataset.groundTruth.length} ground-truth labels.`,
  );

  if (generateOnly) {
    console.log("Done (--generate-only).");
    return;
  }

  const corrections = applyCorrections ? loadCorrections() : [];
  if (applyCorrections) {
    console.log(`Loaded ${corrections.length} human correction(s).`);
  }

  const cfg: Partial<ReconcileConfig> = {
    skipLlm,
    llmProvider,
    llmModel,
    applyCorrections,
  };

  console.log("Reconciling...");
  const result = await reconcile(
    dataset.payments,
    dataset.settlements,
    dataset.bankCredits,
    cfg,
    corrections,
  );

  const llmEnabled = result.timing.llmMs > 0 && !skipLlm && llmProvider !== "none";

  const metrics = scoreAgainstGroundTruth(
    result,
    dataset.groundTruth,
    seed,
    llmEnabled,
    llmProvider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "auto"),
  );

  const suggested = suggestFuzzyThreshold(corrections);
  if (suggested != null) {
    metrics.suggestedFuzzyThreshold = suggested;
    console.log(
      `Suggested fuzzyAcceptThreshold=${suggested} (from human accepts in 0.65–0.75; not auto-applied)`,
    );
  }

  const full: FullReport = {
    metrics,
    matches: result.matches,
    exceptions: result.exceptions,
    knownLimitations: KNOWN_LIMITATIONS,
  };

  const { jsonPath, mdPath, markdown } = writeReport(full);
  copyReportToDashboard(jsonPath);

  console.log("");
  console.log(markdown);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

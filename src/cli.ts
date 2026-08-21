#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAndWrite } from "./data/generate.js";
import type {
  LlmAblationSummary,
  ReconcileConfig,
  RobustnessSummary,
  ScoreReport,
} from "./data/types.js";
import {
  loadCorrectionsWithFallback,
  suggestFuzzyThreshold,
} from "./engine/corrections.js";
import { reconcile } from "./engine/reconcile.js";
import type { LlmProviderChoice } from "./engine/llmResolve.js";
import { selectLlmProvider } from "./engine/llmResolve.js";
import { scoreAgainstGroundTruth } from "./scoring/metrics.js";
import {
  KNOWN_LIMITATIONS,
  writeReport,
  type FullReport,
} from "./scoring/report.js";
import { formatTerminal } from "./scoring/terminalReport.js";
import { dim } from "./cli/ansi.js";
import { printBanner } from "./cli/banner.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]): {
  seed: number;
  generateOnly: boolean;
  skipLlm: boolean;
  llmProvider?: LlmProviderChoice;
  llmModel: string;
  applyCorrections: boolean;
  runs: number;
  compareLlm: boolean;
} {
  let seed = 42;
  let generateOnly = false;
  let skipLlm = false;
  let llmProvider: LlmProviderChoice | undefined;
  let llmModel = "llama3.2";
  let applyCorrections = false;
  let runs = 1;
  let compareLlm = false;

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
    } else if (arg === "--runs") {
      const next = argv[++i];
      if (!next || Number.isNaN(Number(next)) || Number(next) < 1) {
        throw new Error("--runs requires a positive integer");
      }
      runs = Number(next);
    } else if (arg === "--compare-llm") {
      compareLlm = true;
    } else if (arg === "--no-banner") {
      // handled in main(); ignore here
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return {
    seed,
    generateOnly,
    skipLlm,
    llmProvider,
    llmModel,
    applyCorrections,
    runs,
    compareLlm,
  };
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
  --llm-model <name>              Ollama model (default: llama3.2)
  --apply-corrections             Apply corrections (output/ or data/demo_)
  --runs <n>                      Run seeds seed..seed+n-1; report mean±range
  --compare-llm                   Ablate LLM on vs off for the same seed
  --no-banner                     Skip the startup logo (also skipped when not a TTY)
  -h, --help                      Show help
`);
}

function copyReportToDashboard(jsonPath: string): void {
  const destDir = join(ROOT, "dashboard", "public");
  if (!existsSync(join(ROOT, "dashboard"))) return;
  mkdirSync(destDir, { recursive: true });
  copyFileSync(jsonPath, join(destDir, "report.json"));
}

function meanMinMax(values: number[]): { mean: number; min: number; max: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    mean: Number(mean.toFixed(4)),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

async function runOnce(options: {
  seed: number;
  skipLlm: boolean;
  llmProvider?: LlmProviderChoice;
  llmModel: string;
  corrections: import("./data/types.js").Correction[];
}): Promise<{ metrics: ScoreReport; full: FullReport; providerName: string }> {
  const dataset = generateAndWrite(options.seed);
  const cfg: Partial<ReconcileConfig> = {
    skipLlm: options.skipLlm,
    llmProvider: options.llmProvider,
    llmModel: options.llmModel,
  };
  const result = await reconcile(
    dataset.payments,
    dataset.settlements,
    dataset.bankCredits,
    cfg,
    options.corrections,
  );
  const { name: providerName } = await selectLlmProvider({
    skipLlm: options.skipLlm,
    llmProvider: options.llmProvider,
    llmModel: options.llmModel,
  });
  const llmEnabled = providerName !== "none" && !options.skipLlm;
  const metrics = scoreAgainstGroundTruth(
    result,
    dataset.groundTruth,
    options.seed,
    llmEnabled,
    providerName,
  );
  return {
    metrics,
    providerName,
    full: {
      metrics,
      matches: result.matches,
      exceptions: result.exceptions,
      knownLimitations: KNOWN_LIMITATIONS,
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (process.stdout.isTTY && !argv.includes("--no-banner")) {
    printBanner();
  }
  const args = parseArgs(argv);

  if (args.generateOnly) {
    console.log(dim(`Generating synthetic settlement dataset (seed=${args.seed})...`));
    const dataset = generateAndWrite(args.seed);
    console.log(
      dim(
        `Wrote ${dataset.payments.length} payments, ${dataset.settlements.length} settlements, ${dataset.bankCredits.length} bank credits, ${dataset.groundTruth.length} ground-truth labels, ${dataset.demoCorrections.length} demo corrections.`,
      ),
    );
    console.log(dim("Done (--generate-only)."));
    return;
  }

  const corrections = args.applyCorrections
    ? loadCorrectionsWithFallback()
    : [];
  if (args.applyCorrections) {
    console.log(dim(`Loaded ${corrections.length} human correction(s).`));
  }

  if (args.runs > 1) {
    console.log(
      dim(
        `Running robustness suite: ${args.runs} seeds starting at ${args.seed}...`,
      ),
    );
    const seeds: number[] = [];
    const matchRates: number[] = [];
    const precisions: number[] = [];
    const recalls: number[] = [];
    const fps: number[] = [];
    let lastFull: FullReport | null = null;

    for (let i = 0; i < args.runs; i++) {
      const s = args.seed + i;
      seeds.push(s);
      const { metrics, full } = await runOnce({
        seed: s,
        skipLlm: args.skipLlm,
        llmProvider: args.llmProvider,
        llmModel: args.llmModel,
        corrections: i === 0 ? corrections : [],
      });
      matchRates.push(metrics.matchRate);
      precisions.push(metrics.precision);
      recalls.push(metrics.recall);
      fps.push(metrics.falsePositiveRate);
      lastFull = full;
      console.log(
        dim(
          `  seed ${s}: match=${(metrics.matchRate * 100).toFixed(1)}% P=${(metrics.precision * 100).toFixed(1)}% R=${(metrics.recall * 100).toFixed(1)}% FP=${(metrics.falsePositiveRate * 100).toFixed(1)}%`,
        ),
      );
    }

    const robustness: RobustnessSummary = {
      seeds,
      matchRate: meanMinMax(matchRates),
      precision: meanMinMax(precisions),
      recall: meanMinMax(recalls),
      falsePositiveRate: meanMinMax(fps),
    };
    lastFull!.metrics.robustness = robustness;
    const { jsonPath, mdPath } = writeReport(lastFull!);
    copyReportToDashboard(jsonPath);
    console.log(formatTerminal(lastFull!, { jsonPath, mdPath }));
    return;
  }

  if (args.compareLlm) {
    console.log(dim(`LLM ablation for seed ${args.seed}...`));
    const withRun = await runOnce({
      seed: args.seed,
      skipLlm: false,
      llmProvider: args.llmProvider === "none" ? undefined : args.llmProvider,
      llmModel: args.llmModel,
      corrections,
    });
    const withoutRun = await runOnce({
      seed: args.seed,
      skipLlm: true,
      llmProvider: "none",
      llmModel: args.llmModel,
      corrections,
    });
    const ablation: LlmAblationSummary = {
      providerAvailable: withRun.providerName !== "none",
      withLlm: {
        matchRate: withRun.metrics.matchRate,
        precision: withRun.metrics.precision,
        recall: withRun.metrics.recall,
        falsePositiveRate: withRun.metrics.falsePositiveRate,
        llmMatches: withRun.metrics.matchSourceBreakdown.llm,
        provider: withRun.providerName,
      },
      withoutLlm: {
        matchRate: withoutRun.metrics.matchRate,
        precision: withoutRun.metrics.precision,
        recall: withoutRun.metrics.recall,
        falsePositiveRate: withoutRun.metrics.falsePositiveRate,
        llmMatches: withoutRun.metrics.matchSourceBreakdown.llm,
      },
    };
    withRun.full.metrics.llmAblation = ablation;
    const suggested = suggestFuzzyThreshold(corrections);
    if (suggested != null) {
      withRun.full.metrics.suggestedFuzzyThreshold = suggested;
    }
    const { jsonPath, mdPath } = writeReport(withRun.full);
    copyReportToDashboard(jsonPath);
    console.log(formatTerminal(withRun.full, { jsonPath, mdPath }));
    return;
  }

  console.log(dim(`Generating + reconciling (seed=${args.seed})...`));
  const { metrics, full } = await runOnce({
    seed: args.seed,
    skipLlm: args.skipLlm,
    llmProvider: args.llmProvider,
    llmModel: args.llmModel,
    corrections,
  });

  const suggested = suggestFuzzyThreshold(corrections);
  if (suggested != null) {
    metrics.suggestedFuzzyThreshold = suggested;
    console.log(
      dim(
        `Suggested fuzzyAcceptThreshold=${suggested} (from human accepts in 0.65–0.75; not auto-applied)`,
      ),
    );
  }

  const { jsonPath, mdPath } = writeReport(full);
  copyReportToDashboard(jsonPath);
  console.log(formatTerminal(full, { jsonPath, mdPath }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

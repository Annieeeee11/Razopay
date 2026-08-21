#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAndWrite } from "./data/generate.js";
import { reconcile } from "./engine/reconcile.js";
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
} {
  let seed = 42;
  let generateOnly = false;
  let skipLlm = false;

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
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { seed, generateOnly, skipLlm };
}

function printHelp(): void {
  console.log(`Usage: npm run reconcile -- [options]

Razorpay-style payment gateway settlement reconciliation
(Payment → Settlement → Bank payout credit via UTR).

Options:
  --seed <n>         Seeded RNG for reproducible synthetic data (default: 42)
  --generate-only    Write data/*.json and exit
  --skip-llm         Skip LLM pass even if ANTHROPIC_API_KEY is set
  -h, --help         Show help
`);
}

function copyReportToDashboard(jsonPath: string): void {
  const destDir = join(ROOT, "dashboard", "public");
  if (!existsSync(join(ROOT, "dashboard"))) return;
  mkdirSync(destDir, { recursive: true });
  copyFileSync(jsonPath, join(destDir, "report.json"));
}

async function main(): Promise<void> {
  const { seed, generateOnly, skipLlm } = parseArgs(process.argv.slice(2));

  console.log(`Generating synthetic settlement dataset (seed=${seed})...`);
  const dataset = generateAndWrite(seed);
  console.log(
    `Wrote ${dataset.payments.length} payments, ${dataset.settlements.length} settlements, ${dataset.bankCredits.length} bank credits, ${dataset.groundTruth.length} ground-truth labels.`,
  );

  if (generateOnly) {
    console.log("Done (--generate-only).");
    return;
  }

  const llmWouldRun = Boolean(process.env.ANTHROPIC_API_KEY) && !skipLlm;
  console.log(
    `Reconciling (LLM ${llmWouldRun ? "enabled" : "disabled"})...`,
  );

  const result = await reconcile(
    dataset.payments,
    dataset.settlements,
    dataset.bankCredits,
    { skipLlm },
  );
  const metrics = scoreAgainstGroundTruth(
    result,
    dataset.groundTruth,
    seed,
    llmWouldRun,
    llmWouldRun ? "anthropic" : "none",
  );

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

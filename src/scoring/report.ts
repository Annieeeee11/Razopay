import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Exception, MatchResult, ScoreReport } from "../data/types.js";
import { pct } from "./metrics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUTPUT_DIR = join(ROOT, "output");

export interface FullReport {
  metrics: ScoreReport;
  matches: MatchResult[];
  exceptions: Exception[];
  knownLimitations: string[];
}

export const KNOWN_LIMITATIONS = [
  "1:1 settlement↔bank matching for non-batched rows; batched payouts are generated but not yet auto-resolved (Phase 4 split match pending).",
  "No FX conversion — currency mismatches are never auto-resolved.",
  "Fuzzy matching uses net/credited amount, settlement/credit dates, and UTR similarity only.",
  "Duplicate bank credits: first claim wins; extras become exceptions.",
];

export function formatMarkdown(report: FullReport): string {
  const m = report.metrics;
  const lines: string[] = [];

  lines.push("# Payment Gateway Settlement Reconciliation Report");
  lines.push("");
  lines.push(
    "Razorpay-style 3-way flow: **Payment → Settlement → Bank payout credit** (UTR join).",
  );
  lines.push("");
  lines.push(
    `Seed: \`${m.seed}\` · Payments: ${m.paymentCount} · Settlements: ${m.settlementCount} · Bank credits: ${m.bankCount}`,
  );
  lines.push(
    `LLM pass: ${m.llmEnabled ? `enabled (${m.llmProvider ?? "anthropic"})` : "disabled / unavailable"}`,
  );
  lines.push("");

  lines.push("## Headline metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Match rate (recall on true matches) | ${pct(m.matchRate)} |`);
  lines.push(`| Precision | ${pct(m.precision)} |`);
  lines.push(`| Recall | ${pct(m.recall)} |`);
  lines.push(`| False positive rate | ${pct(m.falsePositiveRate)} |`);
  lines.push(`| Exception accuracy | ${pct(m.exceptionAccuracy)} |`);
  lines.push(`| Throughput | ${m.throughputRecordsPerSec} records/sec |`);
  lines.push(`| Runtime (total) | ${m.timing.totalMs.toFixed(2)} ms |`);
  lines.push("");

  lines.push("### Counts");
  lines.push("");
  lines.push(`- True matches in ground truth: ${m.trueMatchCount}`);
  lines.push(`- Predicted matches: ${m.predictedMatchCount}`);
  lines.push(`- True positives: ${m.truePositive}`);
  lines.push(`- False positives: ${m.falsePositive}`);
  lines.push(`- False negatives: ${m.falseNegative}`);
  lines.push(`- True exception records: ${m.trueExceptionCount}`);
  lines.push(`- Predicted exception records: ${m.predictedExceptionCount}`);
  lines.push(`- Correctly flagged exceptions: ${m.correctlyFlaggedExceptions}`);
  lines.push("");

  lines.push("## Match-source breakdown");
  lines.push("");
  lines.push("| Pass | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Exact | ${m.matchSourceBreakdown.exact} |`);
  lines.push(`| Fuzzy | ${m.matchSourceBreakdown.fuzzy} |`);
  lines.push(`| Split | ${m.matchSourceBreakdown.split} |`);
  lines.push(`| LLM | ${m.matchSourceBreakdown.llm} |`);
  lines.push(`| Human | ${m.matchSourceBreakdown.human} |`);
  lines.push("");
  lines.push("| Pass timing | ms |");
  lines.push("| --- | ---: |");
  lines.push(`| Exact | ${m.timing.exactMs.toFixed(2)} |`);
  lines.push(`| Fuzzy | ${m.timing.fuzzyMs.toFixed(2)} |`);
  lines.push(`| Split | ${m.timing.splitMs.toFixed(2)} |`);
  lines.push(`| LLM | ${m.timing.llmMs.toFixed(2)} |`);
  lines.push(`| Total | ${m.timing.totalMs.toFixed(2)} |`);
  lines.push("");

  if (m.suggestedFuzzyThreshold != null) {
    lines.push("## Suggested fuzzy threshold (from human corrections)");
    lines.push("");
    lines.push(
      `Logged suggestion only (not auto-applied): \`fuzzyAcceptThreshold\` → **${m.suggestedFuzzyThreshold}**`,
    );
    lines.push("");
  }

  lines.push("## Exception list");
  lines.push("");
  if (report.exceptions.length === 0) {
    lines.push("_No exceptions._");
  } else {
    lines.push("| Record ID | Source | Reason |");
    lines.push("| --- | --- | --- |");
    for (const e of report.exceptions) {
      const reason = e.reason.replace(/\|/g, "\\|");
      lines.push(`| ${e.recordId} | ${e.source} | ${reason} |`);
    }
  }
  lines.push("");

  lines.push("## Known limitations");
  lines.push("");
  for (const lim of report.knownLimitations) {
    lines.push(`- ${lim}`);
  }
  lines.push("");

  return lines.join("\n");
}

export function writeReport(
  report: FullReport,
  outputDir: string = OUTPUT_DIR,
): { jsonPath: string; mdPath: string; markdown: string } {
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "report.json");
  const mdPath = join(outputDir, "report.md");
  const markdown = formatMarkdown(report);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdPath, markdown);

  return { jsonPath, mdPath, markdown };
}

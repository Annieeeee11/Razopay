import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AmbiguityLevel,
  Exception,
  MatchResult,
  ScoreReport,
} from "../data/types.js";
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
  "Split matching uses bounded subset-sum (max pool 25, max combo 6) — demo-scale only.",
  "Ambiguous multi-solution batches are routed to the LLM/human tier (not auto-picked).",
  "No FX conversion — currency mismatches are never auto-resolved.",
  "Fuzzy matching uses net/credited amount, settlement/credit dates, and UTR similarity (prefix-aware).",
  "Duplicate bank credits: first claim wins; extras become exceptions.",
  "Near-duplicate decoys and boundary UTR mangles are intentional hard cases for LLM/human tiers.",
  "Ollama LLM calls use temperature 0 and a fixed seed for reproducibility; Anthropic uses temperature 0.",
];

export interface GroupedExceptionRow {
  recordIds: string[];
  source: string;
  reason: string;
}

/** Collapse related exception rows for human-readable reports (metrics stay per-record). */
export function groupExceptionsForDisplay(
  exceptions: Exception[],
): GroupedExceptionRow[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p !== x) {
      const root = find(p);
      parent.set(x, root);
      return root;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const e of exceptions) {
    const key = `${e.source}:${e.recordId}`;
    if (!parent.has(key)) parent.set(key, key);
    for (const rid of e.relatedIds ?? []) {
      const candidates = [
        `bank:${rid}`,
        `settlement:${rid}`,
        rid.includes(":") ? rid : "",
      ].filter(Boolean);
      for (const c of candidates) {
        if (exceptions.some((x) => `${x.source}:${x.recordId}` === c)) {
          if (!parent.has(c)) parent.set(c, c);
          union(key, c);
        }
      }
    }
  }

  const groups = new Map<string, Exception[]>();
  for (const e of exceptions) {
    const key = `${e.source}:${e.recordId}`;
    const root = find(key);
    const list = groups.get(root) ?? [];
    list.push(e);
    groups.set(root, list);
  }

  const rows: GroupedExceptionRow[] = [];
  for (const members of groups.values()) {
    const ids = [...new Set(members.map((m) => m.recordId))];
    const sources = [...new Set(members.map((m) => m.source))];
    rows.push({
      recordIds: ids,
      source: sources.join("+"),
      reason: members[0]!.reason,
    });
  }
  return rows;
}

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

  lines.push("## Accuracy by case difficulty");
  lines.push("");
  lines.push("| Difficulty | Match rate | Precision | Deferred | Notes |");
  lines.push("| --- | --- | --- | --- | --- |");
  const order: AmbiguityLevel[] = [
    "clear",
    "boundary",
    "decoy",
    "unresolvable",
  ];
  for (const level of order) {
    const s = m.byAmbiguityLevel[level];
    if (!s) continue;
    const deferred =
      s.deferredTotal != null && s.deferredTotal > 0
        ? pct((s.correctlyDeferred ?? 0) / s.deferredTotal)
        : "—";
    const mr =
      s.trueMatchCount === 0 && (level === "decoy" || level === "unresolvable")
        ? "—"
        : pct(s.matchRate);
    const pr =
      s.trueMatchCount === 0 && s.predictedMatchCount === 0
        ? "—"
        : pct(s.precision);
    lines.push(
      `| ${level[0]!.toUpperCase()}${level.slice(1)} | ${mr} | ${pr} | ${deferred} | ${s.notes} |`,
    );
  }
  lines.push("");

  if (m.robustness) {
    const r = m.robustness;
    lines.push("## Robustness across seeds");
    lines.push("");
    lines.push(`Seeds: ${r.seeds.join(", ")}`);
    lines.push("");
    lines.push("| Metric | Mean | Min | Max |");
    lines.push("| --- | ---: | ---: | ---: |");
    lines.push(
      `| Match rate | ${pct(r.matchRate.mean)} | ${pct(r.matchRate.min)} | ${pct(r.matchRate.max)} |`,
    );
    lines.push(
      `| Precision | ${pct(r.precision.mean)} | ${pct(r.precision.min)} | ${pct(r.precision.max)} |`,
    );
    lines.push(
      `| Recall | ${pct(r.recall.mean)} | ${pct(r.recall.min)} | ${pct(r.recall.max)} |`,
    );
    lines.push(
      `| FP rate | ${pct(r.falsePositiveRate.mean)} | ${pct(r.falsePositiveRate.min)} | ${pct(r.falsePositiveRate.max)} |`,
    );
    lines.push("");
  }

  if (m.llmAblation) {
    const a = m.llmAblation;
    lines.push("## LLM ablation");
    lines.push("");
    if (!a.providerAvailable) {
      lines.push(
        "_No LLM provider available — with-LLM run fell back to none._",
      );
      lines.push("");
    }
    lines.push("| | With LLM | Without LLM |");
    lines.push("| --- | ---: | ---: |");
    lines.push(
      `| Match rate | ${pct(a.withLlm.matchRate)} | ${pct(a.withoutLlm.matchRate)} |`,
    );
    lines.push(
      `| Precision | ${pct(a.withLlm.precision)} | ${pct(a.withoutLlm.precision)} |`,
    );
    lines.push(
      `| Recall | ${pct(a.withLlm.recall)} | ${pct(a.withoutLlm.recall)} |`,
    );
    lines.push(
      `| FP rate | ${pct(a.withLlm.falsePositiveRate)} | ${pct(a.withoutLlm.falsePositiveRate)} |`,
    );
    lines.push(
      `| LLM matches | ${a.withLlm.llmMatches} | ${a.withoutLlm.llmMatches} |`,
    );
    lines.push(`| Provider | ${a.withLlm.provider} | none |`);
    lines.push("");
  }

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
    const grouped = groupExceptionsForDisplay(report.exceptions);
    lines.push("| Record ID(s) | Source | Reason |");
    lines.push("| --- | --- | --- |");
    for (const e of grouped) {
      const reason = e.reason.replace(/\|/g, "\\|");
      lines.push(`| ${e.recordIds.join(", ")} | ${e.source} | ${reason} |`);
    }
    lines.push("");
    lines.push(
      `_Grouped by relatedIds for display (${grouped.length} groups from ${report.exceptions.length} per-record flags). Scoring still uses per-record exceptions._`,
    );
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

import type { AmbiguityLevel } from "../data/types.js";
import {
  bold,
  box,
  cyan,
  dim,
  green,
  red,
  visibleWidth,
  yellow,
} from "../cli/ansi.js";
import { pct } from "./metrics.js";
import type { FullReport } from "./report.js";

const EXCEPTION_PREVIEW = 20;
const LABEL_W = 20;

function metricColor(label: string, value: number): string {
  const text = pct(value);
  if (label === "FP rate") {
    if (value <= 0.03) return green(text);
    if (value <= 0.05) return yellow(text);
    return red(text);
  }
  if (value >= 0.95) return green(text);
  if (value >= 0.88) return cyan(text);
  return yellow(text);
}

function row(label: string, value: string, labelWidth = LABEL_W): string {
  return `${dim(label.padEnd(labelWidth))}   ${value}`;
}

/** Box width = content width only (no shared min that pads empty space). */
function fitWidth(lines: string[]): number {
  let max = 0;
  for (const line of lines) {
    max = Math.max(max, visibleWidth(line) + 2);
  }
  return Math.max(max, 24);
}

export function formatTerminal(
  report: FullReport,
  paths?: { jsonPath?: string; mdPath?: string },
): string {
  const m = report.metrics;
  const out: string[] = [];

  out.push("");

  const llmLabel = m.llmEnabled
    ? green(m.llmProvider ?? "on")
    : yellow("none");
  out.push(
    dim("  status  ") +
      `seed ${bold(String(m.seed))} · ${m.paymentCount} pay / ${m.settlementCount} setl / ${m.bankCount} bank · LLM: ${llmLabel}`,
  );
  out.push("");

  const metricsBody = [
    row("Match rate", metricColor("Match rate", m.matchRate)),
    row("Precision", metricColor("Precision", m.precision)),
    row("Recall", metricColor("Recall", m.recall)),
    row("FP rate", metricColor("FP rate", m.falsePositiveRate)),
    row("Exception acc", pct(m.exceptionAccuracy)),
    "",
    row("GT matches", String(m.trueMatchCount)),
    row("Predicted", String(m.predictedMatchCount)),
    row(
      "TP / FP / FN",
      `${m.truePositive} / ${m.falsePositive} / ${m.falseNegative}`,
    ),
    row("True exceptions", String(m.trueExceptionCount)),
    row("Pred. exceptions", String(m.predictedExceptionCount)),
    row("Correctly flagged", String(m.correctlyFlaggedExceptions)),
    "",
    row(
      "Runtime",
      dim(
        `${m.timing.totalMs.toFixed(1)} ms · ${m.throughputRecordsPerSec} rec/s`,
      ),
    ),
  ];
  const metricsWidth = fitWidth(metricsBody);
  out.push(box(bold("headline metrics"), metricsBody, metricsWidth));
  out.push("");

  const src = m.matchSourceBreakdown;
  const sourcesBody = [
    `${cyan("Exact")} ${src.exact}  ·  ${cyan("Fuzzy")} ${src.fuzzy}  ·  ${cyan("Split")} ${src.split}  ·  ${cyan("LLM")} ${src.llm}  ·  ${cyan("Human")} ${src.human}`,
    dim(
      `timing  exact ${m.timing.exactMs.toFixed(1)} · fuzzy ${m.timing.fuzzyMs.toFixed(1)} · split ${m.timing.splitMs.toFixed(1)} · llm ${m.timing.llmMs.toFixed(1)} ms`,
    ),
  ];
  out.push(box("match sources", sourcesBody, fitWidth(sourcesBody)));
  out.push("");

  const order: AmbiguityLevel[] = [
    "clear",
    "boundary",
    "decoy",
    "unresolvable",
  ];
  const diffBody: string[] = [];
  for (const level of order) {
    const s = m.byAmbiguityLevel[level];
    if (!s) continue;
    const label = level[0]!.toUpperCase() + level.slice(1);
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
    diffBody.push(
      `${padLabel(label, 14)}  match ${mr.padStart(7)}    prec ${pr.padStart(7)}    deferred ${deferred.padStart(7)}`,
    );
  }
  out.push(box("by difficulty", diffBody, fitWidth(diffBody)));
  out.push("");

  if (m.robustness) {
    const r = m.robustness;
    const robBody = [
      dim(`seeds ${r.seeds.join(", ")}`),
      `match  mean ${pct(r.matchRate.mean)}  min ${pct(r.matchRate.min)}  max ${pct(r.matchRate.max)}`,
      `prec   mean ${pct(r.precision.mean)}  min ${pct(r.precision.min)}  max ${pct(r.precision.max)}`,
      `recall mean ${pct(r.recall.mean)}  min ${pct(r.recall.min)}  max ${pct(r.recall.max)}`,
      `FP     mean ${pct(r.falsePositiveRate.mean)}  min ${pct(r.falsePositiveRate.min)}  max ${pct(r.falsePositiveRate.max)}`,
    ];
    out.push(box("robustness", robBody, fitWidth(robBody)));
    out.push("");
  }

  if (m.llmAblation) {
    const a = m.llmAblation;
    const body = [
      !a.providerAvailable
        ? yellow("provider unavailable — with-LLM fell back to none")
        : dim(`provider ${a.withLlm.provider}`),
      "",
      `${"".padEnd(12)}${bold("With LLM").padStart(12)}${bold("Without").padStart(12)}`,
      `match rate  ${pct(a.withLlm.matchRate).padStart(12)}${pct(a.withoutLlm.matchRate).padStart(12)}`,
      `precision   ${pct(a.withLlm.precision).padStart(12)}${pct(a.withoutLlm.precision).padStart(12)}`,
      `recall      ${pct(a.withLlm.recall).padStart(12)}${pct(a.withoutLlm.recall).padStart(12)}`,
      `FP rate     ${pct(a.withLlm.falsePositiveRate).padStart(12)}${pct(a.withoutLlm.falsePositiveRate).padStart(12)}`,
      `LLM matches ${String(a.withLlm.llmMatches).padStart(12)}${String(a.withoutLlm.llmMatches).padStart(12)}`,
    ];
    out.push(box("LLM ablation", body, fitWidth(body)));
    out.push("");
  }

  if (m.suggestedFuzzyThreshold != null) {
    out.push(
      dim(
        `  tip  suggested fuzzyAcceptThreshold=${m.suggestedFuzzyThreshold} (logged only, not auto-applied)`,
      ),
    );
    out.push("");
  }

  const exceptions = report.exceptions;
  const preview = exceptions.slice(0, EXCEPTION_PREVIEW);
  const exBody: string[] = [];
  if (preview.length === 0) {
    exBody.push(green("none"));
  } else {
    for (const e of preview) {
      const id = e.recordId.padEnd(12);
      const srcName = e.source.padEnd(12);
      exBody.push(`${cyan(id)}   ${dim(srcName)}   ${e.reason}`);
    }
    if (exceptions.length > EXCEPTION_PREVIEW) {
      exBody.push(
        dim(
          `… and ${exceptions.length - EXCEPTION_PREVIEW} more (see output/report.md)`,
        ),
      );
    }
  }
  out.push(box(`exceptions (${exceptions.length})`, exBody, fitWidth(exBody)));
  out.push("");

  out.push(
    dim(
      "  limitations  bounded split · no FX · near-dups need LLM/human — full list in report.md",
    ),
  );
  if (paths?.jsonPath || paths?.mdPath) {
    out.push("");
    if (paths.jsonPath) out.push(dim(`  wrote  ${paths.jsonPath}`));
    if (paths.mdPath) out.push(dim(`  wrote  ${paths.mdPath}`));
  }
  out.push("");

  return out.join("\n");
}

function padLabel(s: string, w: number): string {
  return s.padEnd(w);
}

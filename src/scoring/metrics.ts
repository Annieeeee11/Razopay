import type {
  Exception,
  GroundTruthLabel,
  MatchResult,
  MatchSourceBreakdown,
  ReconcileResult,
  ScoreReport,
} from "../data/types.js";

function sortedSetKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

function matchEqualsGt(m: MatchResult, g: GroundTruthLabel): boolean {
  if (!g.bankCreditId || m.bankCreditId !== g.bankCreditId) return false;
  if (g.settlementIds && g.settlementIds.length > 1) {
    const comps = m.components ?? [m.settlementId];
    return sortedSetKey(comps) === sortedSetKey(g.settlementIds);
  }
  return Boolean(g.settlementId && m.settlementId === g.settlementId);
}

export function scoreAgainstGroundTruth(
  result: ReconcileResult,
  groundTruth: GroundTruthLabel[],
  seed: number,
  llmEnabled: boolean,
  llmProvider = "none",
): ScoreReport {
  const trueMatches = groundTruth.filter((g) => g.label === "match");

  let truePositive = 0;
  let falsePositive = 0;
  const claimedGt = new Set<number>();

  for (const m of result.matches) {
    const idx = trueMatches.findIndex(
      (g, i) => !claimedGt.has(i) && matchEqualsGt(m, g),
    );
    if (idx >= 0) {
      truePositive++;
      claimedGt.add(idx);
    } else {
      falsePositive++;
    }
  }

  const falseNegative = trueMatches.length - truePositive;

  const precision =
    result.matches.length === 0 ? 1 : truePositive / result.matches.length;
  const recall =
    trueMatches.length === 0 ? 1 : truePositive / trueMatches.length;
  const falsePositiveRate =
    result.matches.length === 0 ? 0 : falsePositive / result.matches.length;

  const trueExceptionIds = new Set<string>();
  for (const g of groundTruth) {
    if (g.label !== "exception") continue;
    if (g.bankCreditId) trueExceptionIds.add(`bank:${g.bankCreditId}`);
    if (g.settlementId) trueExceptionIds.add(`settlement:${g.settlementId}`);
  }

  // Batched payouts that are unmatched should not count as "true exceptions"
  // for settlement components — they are true matches awaiting split.
  // Exception accuracy uses only explicit exception labels.

  const predictedExceptionIds = new Set(
    result.exceptions.map((e) => `${e.source}:${e.recordId}`),
  );

  let correctlyFlaggedExceptions = 0;
  for (const id of predictedExceptionIds) {
    if (trueExceptionIds.has(id)) correctlyFlaggedExceptions++;
  }

  const exceptionAccuracy =
    predictedExceptionIds.size === 0
      ? 1
      : correctlyFlaggedExceptions / predictedExceptionIds.size;

  const totalRecords = result.bankCount + result.settlementCount;
  const totalSec = Math.max(result.timing.totalMs / 1000, 1e-9);

  const matchSourceBreakdown: MatchSourceBreakdown = {
    exact: result.matches.filter((m) => m.matchedBy === "exact").length,
    fuzzy: result.matches.filter((m) => m.matchedBy === "fuzzy").length,
    split: result.matches.filter((m) => m.matchedBy === "split").length,
    llm: result.matches.filter((m) => m.matchedBy === "llm").length,
    human: result.matches.filter((m) => m.matchedBy === "human").length,
  };

  return {
    matchRate: recall,
    precision,
    recall,
    falsePositiveRate,
    exceptionAccuracy,
    trueMatchCount: trueMatches.length,
    predictedMatchCount: result.matches.length,
    truePositive,
    falsePositive,
    falseNegative,
    trueExceptionCount: trueExceptionIds.size,
    predictedExceptionCount: predictedExceptionIds.size,
    correctlyFlaggedExceptions,
    throughputRecordsPerSec: Number((totalRecords / totalSec).toFixed(2)),
    timing: result.timing,
    matchSourceBreakdown,
    bankCount: result.bankCount,
    settlementCount: result.settlementCount,
    paymentCount: result.paymentCount,
    seed,
    llmEnabled,
    llmProvider,
  };
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function scoreMatches(
  matches: MatchResult[],
  exceptions: Exception[],
  groundTruth: GroundTruthLabel[],
  meta: {
    bankCount: number;
    settlementCount: number;
    paymentCount: number;
    timing: ReconcileResult["timing"];
    seed: number;
    llmEnabled: boolean;
  },
): ScoreReport {
  return scoreAgainstGroundTruth(
    {
      matches,
      exceptions,
      ambiguousResolved: matches.filter((m) => m.matchedBy === "llm").length,
      timing: meta.timing,
      bankCount: meta.bankCount,
      settlementCount: meta.settlementCount,
      paymentCount: meta.paymentCount,
    },
    groundTruth,
    meta.seed,
    meta.llmEnabled,
  );
}

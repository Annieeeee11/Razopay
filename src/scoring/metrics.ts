import type {
  Exception,
  GroundTruthLabel,
  MatchResult,
  MatchSourceBreakdown,
  ReconcileResult,
  ScoreReport,
} from "../data/types.js";

function pairKey(bankId: string, ledgerId: string): string {
  return `${bankId}||${ledgerId}`;
}

export function scoreAgainstGroundTruth(
  result: ReconcileResult,
  groundTruth: GroundTruthLabel[],
  seed: number,
  llmEnabled: boolean,
): ScoreReport {
  const trueMatches = groundTruth.filter(
    (g) => g.label === "match" && g.bankId && g.ledgerId,
  );
  const trueMatchKeys = new Set(
    trueMatches.map((g) => pairKey(g.bankId!, g.ledgerId!)),
  );

  const predicted = result.matches;
  const predictedKeys = new Set(
    predicted.map((m) => pairKey(m.bankId, m.ledgerId)),
  );

  let truePositive = 0;
  let falsePositive = 0;
  for (const m of predicted) {
    if (trueMatchKeys.has(pairKey(m.bankId, m.ledgerId))) truePositive++;
    else falsePositive++;
  }

  let falseNegative = 0;
  for (const key of trueMatchKeys) {
    if (!predictedKeys.has(key)) falseNegative++;
  }

  const precision =
    predicted.length === 0 ? 1 : truePositive / predicted.length;
  const recall =
    trueMatches.length === 0 ? 1 : truePositive / trueMatches.length;
  // FP rate among predicted matches (controller-relevant)
  const falsePositiveRate =
    predicted.length === 0 ? 0 : falsePositive / predicted.length;

  // Exception accuracy: of records the engine flagged, % that are true exceptions
  const trueExceptionIds = new Set<string>();
  for (const g of groundTruth) {
    if (g.label !== "exception") continue;
    if (g.bankId) trueExceptionIds.add(`bank:${g.bankId}`);
    if (g.ledgerId) trueExceptionIds.add(`ledger:${g.ledgerId}`);
  }

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

  const totalRecords = result.bankCount + result.ledgerCount;
  const totalSec = Math.max(result.timing.totalMs / 1000, 1e-9);
  const throughputRecordsPerSec = totalRecords / totalSec;

  const matchSourceBreakdown: MatchSourceBreakdown = {
    exact: predicted.filter((m) => m.matchedBy === "exact").length,
    fuzzy: predicted.filter((m) => m.matchedBy === "fuzzy").length,
    llm: predicted.filter((m) => m.matchedBy === "llm").length,
  };

  return {
    matchRate: recall, // % of true matches found (recall on match class)
    precision,
    recall,
    falsePositiveRate,
    exceptionAccuracy,
    trueMatchCount: trueMatches.length,
    predictedMatchCount: predicted.length,
    truePositive,
    falsePositive,
    falseNegative,
    trueExceptionCount: trueExceptionIds.size,
    predictedExceptionCount: predictedExceptionIds.size,
    correctlyFlaggedExceptions,
    throughputRecordsPerSec: Number(throughputRecordsPerSec.toFixed(2)),
    timing: result.timing,
    matchSourceBreakdown,
    bankCount: result.bankCount,
    ledgerCount: result.ledgerCount,
    seed,
    llmEnabled,
  };
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

/** Pure helper for unit tests: score arbitrary predicted matches vs GT. */
export function scoreMatches(
  matches: MatchResult[],
  exceptions: Exception[],
  groundTruth: GroundTruthLabel[],
  meta: {
    bankCount: number;
    ledgerCount: number;
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
      ledgerCount: meta.ledgerCount,
    },
    groundTruth,
    meta.seed,
    meta.llmEnabled,
  );
}

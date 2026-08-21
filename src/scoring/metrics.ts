import type {
  AmbiguityLevel,
  AmbiguitySliceMetrics,
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
  if (g.settlementIds && g.settlementIds.length > 1 && g.label === "match") {
    const comps = m.components ?? [m.settlementId];
    return sortedSetKey(comps) === sortedSetKey(g.settlementIds);
  }
  return Boolean(g.settlementId && m.settlementId === g.settlementId);
}

function emptySlice(notes: string): AmbiguitySliceMetrics {
  return {
    matchRate: 0,
    precision: 1,
    recall: 1,
    trueMatchCount: 0,
    predictedMatchCount: 0,
    truePositive: 0,
    falsePositive: 0,
    notes,
  };
}

function scoreSlice(
  level: AmbiguityLevel,
  result: ReconcileResult,
  groundTruth: GroundTruthLabel[],
): AmbiguitySliceMetrics {
  const levelGt = groundTruth.filter((g) => g.ambiguityLevel === level);
  const trueMatches = levelGt.filter((g) => g.label === "match");
  const deferredRows = levelGt.filter(
    (g) => g.label === "exception" || level === "decoy" || level === "unresolvable",
  );

  // Predicted matches whose GT pair (if any) is at this level, or wrong matches
  // involving bank credits tagged at this level.
  const levelBankIds = new Set(
    levelGt.map((g) => g.bankCreditId).filter(Boolean) as string[],
  );
  const levelSettlementIds = new Set(
    levelGt.map((g) => g.settlementId).filter(Boolean) as string[],
  );

  const predicted = result.matches.filter(
    (m) =>
      levelBankIds.has(m.bankCreditId) ||
      levelSettlementIds.has(m.settlementId) ||
      (m.components?.some((id) => levelSettlementIds.has(id)) ?? false),
  );

  let truePositive = 0;
  let falsePositive = 0;
  const claimed = new Set<number>();

  for (const m of predicted) {
    const idx = trueMatches.findIndex(
      (g, i) => !claimed.has(i) && matchEqualsGt(m, g),
    );
    if (idx >= 0) {
      truePositive++;
      claimed.add(idx);
    } else {
      // Wrong match involving this level's records
      falsePositive++;
    }
  }

  const precision =
    predicted.length === 0 ? 1 : truePositive / predicted.length;
  const recall =
    trueMatches.length === 0 ? 1 : truePositive / trueMatches.length;

  // Correctly deferred: exception GT rows not incorrectly auto-matched
  let correctlyDeferred = 0;
  let deferredTotal = 0;
  if (level === "decoy" || level === "unresolvable") {
    const exceptionRows = levelGt.filter((g) => g.label === "exception");
    deferredTotal = exceptionRows.length;
    for (const g of exceptionRows) {
      const wronglyMatched =
        (g.bankCreditId &&
          result.matches.some((m) => m.bankCreditId === g.bankCreditId)) ||
        (g.settlementId &&
          result.matches.some(
            (m) =>
              m.settlementId === g.settlementId ||
              m.components?.includes(g.settlementId!),
          ));
      // Near-dup decoy: matching the decoy settlement is wrong; matching true bank is OK for the match row
      if (g.exceptionType === "near_duplicate_decoy" && g.settlementId) {
        const decoyPicked = result.matches.some(
          (m) =>
            m.settlementId === g.settlementId ||
            m.components?.includes(g.settlementId!),
        );
        if (!decoyPicked) correctlyDeferred++;
        continue;
      }
      if (!wronglyMatched) correctlyDeferred++;
    }
    // Also: decoy match rows that were NOT matched to the decoy (true match or deferred OK)
    for (const g of trueMatches) {
      if (!g.decoySettlementId) continue;
      deferredTotal++;
      const pickedDecoy = result.matches.some(
        (m) =>
          m.bankCreditId === g.bankCreditId &&
          (m.settlementId === g.decoySettlementId ||
            m.components?.includes(g.decoySettlementId!)),
      );
      if (!pickedDecoy) correctlyDeferred++;
    }
  }

  const notes =
    level === "clear"
      ? "trivial exact/fuzzy cases"
      : level === "boundary"
        ? "at fuzzy threshold edge"
        : level === "decoy"
          ? "correctly deferred, not auto-resolved to decoy"
          : "correctly flagged as exception";

  void deferredRows;

  return {
    matchRate: recall,
    precision,
    recall,
    trueMatchCount: trueMatches.length,
    predictedMatchCount: predicted.length,
    truePositive,
    falsePositive,
    correctlyDeferred:
      level === "decoy" || level === "unresolvable"
        ? correctlyDeferred
        : undefined,
    deferredTotal:
      level === "decoy" || level === "unresolvable" ? deferredTotal : undefined,
    notes,
  };
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

  const levels: AmbiguityLevel[] = [
    "clear",
    "boundary",
    "decoy",
    "unresolvable",
  ];
  const byAmbiguityLevel = {} as Record<AmbiguityLevel, AmbiguitySliceMetrics>;
  for (const level of levels) {
    byAmbiguityLevel[level] = scoreSlice(level, result, groundTruth);
  }

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
    byAmbiguityLevel,
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

export { emptySlice };

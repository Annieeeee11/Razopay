import type {
  AmbiguousCandidate,
  BankCreditRecord,
  Exception,
  MatchResult,
  ReconcileConfig,
  SettlementRecord,
} from "../data/types.js";
import { DEFAULT_CONFIG, amountTolerance } from "./config.js";

/**
 * Bounded subset-sum for batched payouts (demo-scale).
 * Caps: pool ≤ splitMaxPool, combination size ≤ splitMaxCombo.
 * Naive DP over a capped pool is intentional — not production-scale matching.
 */

function daysApart(a: string, b: string): number {
  const ms =
    Math.abs(
      new Date(`${a}T12:00:00Z`).getTime() -
        new Date(`${b}T12:00:00Z`).getTime(),
    ) /
    (1000 * 60 * 60 * 24);
  return ms;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Find all subsets (by index) of size 2..maxCombo summing to target within tol. */
export function findSubsetSums(
  amounts: number[],
  target: number,
  tol: number,
  maxCombo: number,
): number[][] {
  const n = amounts.length;
  const solutions: number[][] = [];

  function dfs(start: number, chosen: number[], sum: number): void {
    if (chosen.length >= 2) {
      if (Math.abs(sum - target) <= tol) {
        solutions.push([...chosen]);
      }
    }
    if (chosen.length >= maxCombo) return;
    for (let i = start; i < n; i++) {
      const next = roundMoney(sum + (amounts[i] ?? 0));
      // prune if already over target+tol
      if (next > target + tol) continue;
      chosen.push(i);
      dfs(i + 1, chosen, next);
      chosen.pop();
    }
  }

  dfs(0, [], 0);
  return solutions;
}

export interface SplitMatchResult {
  matches: MatchResult[];
  ambiguous: AmbiguousCandidate[];
  exceptions: Exception[];
  remainingBank: BankCreditRecord[];
  remainingSettlements: SettlementRecord[];
}

export function splitMatch(
  bankPool: BankCreditRecord[],
  settlementPool: SettlementRecord[],
  config: ReconcileConfig = DEFAULT_CONFIG,
): SplitMatchResult {
  const matches: MatchResult[] = [];
  const ambiguous: AmbiguousCandidate[] = [];
  const exceptions: Exception[] = [];
  const usedSettlements = new Set<string>();
  const resolvedBank = new Set<string>();

  for (const bank of bankPool) {
    if (resolvedBank.has(bank.id)) continue;

    let candidates = settlementPool.filter(
      (s) =>
        !usedSettlements.has(s.settlementId) &&
        s.currency === bank.currency &&
        daysApart(s.settledAt, bank.creditedAt) <= config.splitDateWindowDays,
    );

    // Prefer settlements whose UTR is derived from this bank UTR (batch marker)
    const linked = candidates.filter((s) =>
      s.utr.startsWith(`${bank.utr}_S`),
    );
    if (linked.length >= 2) candidates = linked;

    if (candidates.length < 2) continue;

    candidates = candidates.slice(0, config.splitMaxPool);
    const amounts = candidates.map((s) => s.netAmount);
    const tol = amountTolerance(bank.creditedAmount, config);
    const solutions = findSubsetSums(
      amounts,
      bank.creditedAmount,
      tol,
      config.splitMaxCombo,
    );

    if (solutions.length === 0) continue;

    if (solutions.length > 1) {
      const splitOptions = solutions.slice(0, 5).map((sol) =>
        sol.map((i) => candidates[i]!.settlementId).sort(),
      );
      const primarySettlement = candidates[solutions[0]![0]!]!;
      // Don't auto-resolve; leave for LLM with candidate sets listed
      ambiguous.push({
        bank,
        settlement: primarySettlement,
        score: 0.5,
        reasoning: `ambiguous split — multiple settlement combinations sum to credit: ${splitOptions
          .map((ids) => ids.join("+"))
          .join(" | ")}`,
        splitOptions,
        kind: "split",
      });
      resolvedBank.add(bank.id);
      // Leave settlements free for LLM to claim a chosen combination
      continue;
    }

    const sol = solutions[0]!;
    const components = sol.map((i) => candidates[i]!.settlementId);
    for (const id of components) usedSettlements.add(id);
    resolvedBank.add(bank.id);

    matches.push({
      bankCreditId: bank.id,
      settlementId: components[0]!,
      components,
      confidence: 1.0,
      matchedBy: "split",
      reasoning: `Unique subset-sum: ${components.join(" + ")} = ${bank.creditedAmount}`,
    });
  }

  return {
    matches,
    ambiguous,
    exceptions,
    remainingBank: bankPool.filter((b) => !resolvedBank.has(b.id)),
    remainingSettlements: settlementPool.filter(
      (s) => !usedSettlements.has(s.settlementId),
    ),
  };
}

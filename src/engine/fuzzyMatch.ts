import type {
  AmbiguousCandidate,
  BankCreditRecord,
  Exception,
  MatchResult,
  ReconcileConfig,
  SettlementRecord,
} from "../data/types.js";
import { DEFAULT_CONFIG, amountTolerance } from "./config.js";

export function normalizeReference(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[n] ?? 0;
}

export function referenceSimilarity(a: string, b: string): number {
  const na = normalizeReference(a);
  const nb = normalizeReference(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const lev = 1 - dist / maxLen;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  // Truncated bank UTRs are a documented generator mangle; short prefixes are weak evidence.
  if (shorter.length >= 6 && longer.startsWith(shorter)) {
    return Math.max(lev, 0.9);
  }
  return lev;
}

function parseDate(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getTime();
}

function daysApart(a: string, b: string): number {
  return Math.abs(parseDate(a) - parseDate(b)) / (1000 * 60 * 60 * 24);
}

function amountScore(
  bankAmount: number,
  settlementAmount: number,
  config: ReconcileConfig,
): number {
  const diff = Math.abs(bankAmount - settlementAmount);
  const tol = amountTolerance(bankAmount, config);
  if (diff === 0) return 1;
  if (diff > tol) return 0;
  return 1 - diff / tol;
}

function dateScore(
  bankDate: string,
  settlementDate: string,
  config: ReconcileConfig,
): number {
  const days = daysApart(bankDate, settlementDate);
  if (days === 0) return 1;
  if (days > config.dateWindowDays) return 0;
  return 1 - days / (config.dateWindowDays + 1);
}

export function scorePair(
  bank: BankCreditRecord,
  settlement: SettlementRecord,
  config: ReconcileConfig = DEFAULT_CONFIG,
): { score: number; reason: string; currencyMismatch: boolean } {
  if (bank.currency !== settlement.currency) {
    return {
      score: 0,
      reason: "currency mismatch, not auto-resolved",
      currencyMismatch: true,
    };
  }

  const a = amountScore(bank.creditedAmount, settlement.netAmount, config);
  const d = dateScore(bank.creditedAt, settlement.settledAt, config);
  const r = referenceSimilarity(bank.utr, settlement.utr);

  if (a === 0 || d === 0) {
    return {
      score: 0,
      reason: "no counterpart within date/amount window",
      currencyMismatch: false,
    };
  }

  const score =
    config.weightAmount * a +
    config.weightDate * d +
    config.weightReference * r;

  const parts: string[] = [];
  if (a < 1)
    parts.push(`amount delta within tolerance (score ${a.toFixed(2)})`);
  if (d < 1)
    parts.push(
      `date off by ${daysApart(bank.creditedAt, settlement.settledAt).toFixed(0)}d`,
    );
  if (r < 1) parts.push(`UTR similarity ${r.toFixed(2)}`);
  if (parts.length === 0) parts.push("near-exact fuzzy agreement");

  return { score, reason: parts.join("; "), currencyMismatch: false };
}

export interface FuzzyMatchResult {
  matches: MatchResult[];
  ambiguous: AmbiguousCandidate[];
  exceptions: Exception[];
  remainingBank: BankCreditRecord[];
  remainingSettlements: SettlementRecord[];
}

export function fuzzyMatch(
  bankPool: BankCreditRecord[],
  settlementPool: SettlementRecord[],
  config: ReconcileConfig = DEFAULT_CONFIG,
): FuzzyMatchResult {
  const matches: MatchResult[] = [];
  const ambiguous: AmbiguousCandidate[] = [];
  const exceptions: Exception[] = [];

  const usedSettlement = new Set<string>();
  const resolvedBank = new Set<string>();

  type Scored = {
    bank: BankCreditRecord;
    settlement: SettlementRecord;
    score: number;
    reason: string;
    currencyMismatch: boolean;
  };

  const candidates: Scored[] = [];
  const minRefSimilarity = 0.65;

  for (const bank of bankPool) {
    for (const settlement of settlementPool) {
      if (
        bank.currency !== settlement.currency &&
        bank.utr === settlement.utr &&
        bank.creditedAt === settlement.settledAt &&
        bank.creditedAmount === settlement.netAmount
      ) {
        candidates.push({
          bank,
          settlement,
          score: 0,
          reason: "currency mismatch, not auto-resolved",
          currencyMismatch: true,
        });
        continue;
      }

      const { score, reason, currencyMismatch } = scorePair(
        bank,
        settlement,
        config,
      );
      if (currencyMismatch) continue;

      const refSim = referenceSimilarity(bank.utr, settlement.utr);
      if (refSim < minRefSimilarity) continue;

      if (score >= config.ambiguousLow) {
        candidates.push({
          bank,
          settlement,
          score,
          reason,
          currencyMismatch: false,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const currencyMismatchBank = new Set<string>();
  const currencyMismatchSettlement = new Set<string>();

  for (const c of candidates) {
    if (c.currencyMismatch) {
      if (
        c.bank.utr === c.settlement.utr &&
        c.bank.creditedAt === c.settlement.settledAt &&
        c.bank.creditedAmount === c.settlement.netAmount
      ) {
        currencyMismatchBank.add(c.bank.id);
        currencyMismatchSettlement.add(c.settlement.settlementId);
      }
      continue;
    }
    if (
      resolvedBank.has(c.bank.id) ||
      usedSettlement.has(c.settlement.settlementId)
    )
      continue;

    if (c.score >= config.fuzzyAcceptThreshold) {
      resolvedBank.add(c.bank.id);
      usedSettlement.add(c.settlement.settlementId);
      matches.push({
        bankCreditId: c.bank.id,
        settlementId: c.settlement.settlementId,
        confidence: Number(c.score.toFixed(4)),
        matchedBy: "fuzzy",
        reasoning: c.reason,
      });
    } else if (
      c.score >= config.ambiguousLow &&
      c.score < config.ambiguousHigh
    ) {
      resolvedBank.add(c.bank.id);

      // Top-K scored settlements for this bank (primary + rivals) for LLM disambiguation.
      const TOP_K = 3;
      const forBank = candidates
        .filter(
          (x) =>
            !x.currencyMismatch &&
            x.bank.id === c.bank.id &&
            x.score >= config.ambiguousLow &&
            !usedSettlement.has(x.settlement.settlementId),
        )
        .sort((a, b) => b.score - a.score);
      const top = forBank.slice(0, TOP_K);
      const primary = top[0] ?? c;
      usedSettlement.add(primary.settlement.settlementId);
      const rivals = top.slice(1).map((r) => ({
        settlement: r.settlement,
        score: Number(r.score.toFixed(4)),
        reasoning: r.reason,
      }));

      ambiguous.push({
        bank: primary.bank,
        settlement: primary.settlement,
        score: Number(primary.score.toFixed(4)),
        reasoning: primary.reason,
        rivals: rivals.length > 0 ? rivals : undefined,
        kind: "fuzzy",
      });
    }
  }

  for (const bank of bankPool) {
    if (resolvedBank.has(bank.id)) continue;
    if (currencyMismatchBank.has(bank.id)) {
      exceptions.push({
        recordId: bank.id,
        source: "bank",
        reason: "currency mismatch, not auto-resolved",
        exceptionType: "currency_mismatch",
      });
      resolvedBank.add(bank.id);
    }
  }

  for (const settlement of settlementPool) {
    if (usedSettlement.has(settlement.settlementId)) continue;
    if (currencyMismatchSettlement.has(settlement.settlementId)) {
      exceptions.push({
        recordId: settlement.settlementId,
        source: "settlement",
        reason: "currency mismatch, not auto-resolved",
        exceptionType: "currency_mismatch",
      });
      usedSettlement.add(settlement.settlementId);
    }
  }

  // Leftovers stay in remaining* for split / LLM / final exception pass
  return {
    matches,
    ambiguous,
    exceptions,
    remainingBank: bankPool.filter((b) => !resolvedBank.has(b.id)),
    remainingSettlements: settlementPool.filter(
      (s) => !usedSettlement.has(s.settlementId),
    ),
  };
}

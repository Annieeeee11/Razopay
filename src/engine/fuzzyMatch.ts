import type {
  AmbiguousCandidate,
  BankTxn,
  Exception,
  LedgerEntry,
  MatchResult,
  ReconcileConfig,
} from "../data/types.js";
import { DEFAULT_CONFIG, amountTolerance } from "./config.js";

/** Normalize reference codes for similarity: uppercase, strip non-alphanumeric. */
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

/** Similarity in [0, 1] from normalized Levenshtein distance. */
export function referenceSimilarity(a: string, b: string): number {
  const na = normalizeReference(a);
  const nb = normalizeReference(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

function parseDate(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getTime();
}

function daysApart(a: string, b: string): number {
  return Math.abs(parseDate(a) - parseDate(b)) / (1000 * 60 * 60 * 24);
}

function amountScore(
  bankAmount: number,
  ledgerAmount: number,
  config: ReconcileConfig,
): number {
  const diff = Math.abs(bankAmount - ledgerAmount);
  const tol = amountTolerance(bankAmount, config);
  if (diff === 0) return 1;
  if (diff > tol) return 0;
  return 1 - diff / tol;
}

function dateScore(
  bankDate: string,
  ledgerDate: string,
  config: ReconcileConfig,
): number {
  const days = daysApart(bankDate, ledgerDate);
  if (days === 0) return 1;
  // Inclusive window: day == dateWindowDays must still score > 0
  if (days > config.dateWindowDays) return 0;
  return 1 - days / (config.dateWindowDays + 1);
}

export function scorePair(
  bank: BankTxn,
  ledger: LedgerEntry,
  config: ReconcileConfig = DEFAULT_CONFIG,
): { score: number; reason: string; currencyMismatch: boolean } {
  if (bank.currency !== ledger.currency) {
    return {
      score: 0,
      reason: "currency mismatch, not auto-resolved",
      currencyMismatch: true,
    };
  }

  const a = amountScore(bank.amount, ledger.amount, config);
  const d = dateScore(bank.date, ledger.date, config);
  const r = referenceSimilarity(bank.referenceCode, ledger.referenceCode);

  // Hard gate: must be inside date window and amount tolerance to be a candidate
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
  if (a < 1) parts.push(`amount delta within tolerance (score ${a.toFixed(2)})`);
  if (d < 1) parts.push(`date off by ${daysApart(bank.date, ledger.date).toFixed(0)}d`);
  if (r < 1) parts.push(`reference similarity ${r.toFixed(2)}`);
  if (parts.length === 0) parts.push("near-exact fuzzy agreement");

  return {
    score,
    reason: parts.join("; "),
    currencyMismatch: false,
  };
}

export interface FuzzyMatchResult {
  matches: MatchResult[];
  ambiguous: AmbiguousCandidate[];
  exceptions: Exception[];
  remainingBank: BankTxn[];
  remainingLedger: LedgerEntry[];
}

/**
 * Pass 2: fuzzy match on remaining pool.
 * Accept >= 0.75; 0.50–0.75 → ambiguous; else exception with reason.
 */
export function fuzzyMatch(
  bankPool: BankTxn[],
  ledgerPool: LedgerEntry[],
  config: ReconcileConfig = DEFAULT_CONFIG,
): FuzzyMatchResult {
  const matches: MatchResult[] = [];
  const ambiguous: AmbiguousCandidate[] = [];
  const exceptions: Exception[] = [];

  const usedLedger = new Set<string>();
  const resolvedBank = new Set<string>();

  // Currency-mismatch bank rows: flag immediately (still try to note best ledger)
  type Scored = {
    bank: BankTxn;
    ledger: LedgerEntry;
    score: number;
    reason: string;
    currencyMismatch: boolean;
  };

  const candidates: Scored[] = [];
  // High enough to block chance collisions between unrelated missing rows
  const minRefSimilarity = 0.65;

  for (const bank of bankPool) {
    for (const ledger of ledgerPool) {
      // Explicit currency-mismatch detection (same economic identity, no FX)
      if (
        bank.currency !== ledger.currency &&
        bank.referenceCode === ledger.referenceCode &&
        bank.date === ledger.date &&
        bank.amount === ledger.amount
      ) {
        candidates.push({
          bank,
          ledger,
          score: 0,
          reason: "currency mismatch, not auto-resolved",
          currencyMismatch: true,
        });
        continue;
      }

      const { score, reason, currencyMismatch } = scorePair(bank, ledger, config);
      if (currencyMismatch) continue;

      const refSim = referenceSimilarity(bank.referenceCode, ledger.referenceCode);
      // Reject weak-reference cross-matches even when amount/date align by chance
      if (refSim < minRefSimilarity) continue;

      if (score >= config.ambiguousLow) {
        candidates.push({ bank, ledger, score, reason, currencyMismatch: false });
      }
    }
  }

  // Prefer highest scores first (greedy 1:1)
  candidates.sort((a, b) => b.score - a.score);

  const currencyMismatchBank = new Set<string>();
  const currencyMismatchLedger = new Set<string>();

  for (const c of candidates) {
    if (c.currencyMismatch) {
      // Same ref + date + amount but different currency → both sides exception
      if (
        c.bank.referenceCode === c.ledger.referenceCode &&
        c.bank.date === c.ledger.date &&
        c.bank.amount === c.ledger.amount
      ) {
        currencyMismatchBank.add(c.bank.id);
        currencyMismatchLedger.add(c.ledger.id);
      }
      continue;
    }
    if (resolvedBank.has(c.bank.id) || usedLedger.has(c.ledger.id)) continue;

    if (c.score >= config.fuzzyAcceptThreshold) {
      resolvedBank.add(c.bank.id);
      usedLedger.add(c.ledger.id);
      matches.push({
        bankId: c.bank.id,
        ledgerId: c.ledger.id,
        confidence: Number(c.score.toFixed(4)),
        matchedBy: "fuzzy",
        reasoning: c.reason,
      });
    } else if (
      c.score >= config.ambiguousLow &&
      c.score < config.ambiguousHigh
    ) {
      resolvedBank.add(c.bank.id);
      usedLedger.add(c.ledger.id);
      ambiguous.push({
        bank: c.bank,
        ledger: c.ledger,
        score: Number(c.score.toFixed(4)),
        reasoning: c.reason,
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
      });
      resolvedBank.add(bank.id);
      continue;
    }
    exceptions.push({
      recordId: bank.id,
      source: "bank",
      reason: "no counterpart within date/amount window",
    });
    resolvedBank.add(bank.id);
  }

  for (const ledger of ledgerPool) {
    if (usedLedger.has(ledger.id)) continue;
    if (currencyMismatchLedger.has(ledger.id)) {
      exceptions.push({
        recordId: ledger.id,
        source: "ledger",
        reason: "currency mismatch, not auto-resolved",
      });
      usedLedger.add(ledger.id);
      continue;
    }
    exceptions.push({
      recordId: ledger.id,
      source: "ledger",
      reason: "no counterpart within date/amount window",
    });
    usedLedger.add(ledger.id);
  }

  return {
    matches,
    ambiguous,
    exceptions,
    remainingBank: bankPool.filter((b) => !resolvedBank.has(b.id)),
    remainingLedger: ledgerPool.filter((l) => !usedLedger.has(l.id)),
  };
}

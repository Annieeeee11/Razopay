import type {
  BankTxn,
  LedgerEntry,
  MatchResult,
} from "../data/types.js";

function sameDay(a: string, b: string): boolean {
  return a === b;
}

/**
 * Pass 1: exact match on referenceCode + amount + currency + date.
 * Greedy 1:1 — first unused ledger wins for each bank txn.
 */
export function exactMatch(
  bankPool: BankTxn[],
  ledgerPool: LedgerEntry[],
): {
  matches: MatchResult[];
  remainingBank: BankTxn[];
  remainingLedger: LedgerEntry[];
} {
  const usedLedger = new Set<string>();
  const matchedBank = new Set<string>();
  const matches: MatchResult[] = [];

  for (const bank of bankPool) {
    const hit = ledgerPool.find(
      (ledger) =>
        !usedLedger.has(ledger.id) &&
        ledger.referenceCode === bank.referenceCode &&
        ledger.amount === bank.amount &&
        ledger.currency === bank.currency &&
        sameDay(ledger.date, bank.date),
    );
    if (!hit) continue;
    usedLedger.add(hit.id);
    matchedBank.add(bank.id);
    matches.push({
      bankId: bank.id,
      ledgerId: hit.id,
      confidence: 1.0,
      matchedBy: "exact",
      reasoning: "Exact reference, amount, currency, and date match",
    });
  }

  return {
    matches,
    remainingBank: bankPool.filter((b) => !matchedBank.has(b.id)),
    remainingLedger: ledgerPool.filter((l) => !usedLedger.has(l.id)),
  };
}

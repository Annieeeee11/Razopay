import type {
  BankCreditRecord,
  MatchResult,
  SettlementRecord,
} from "../data/types.js";

/**
 * Pass 1: exact match on utr + creditedAmount === netAmount + same date + same currency.
 */
export function exactMatch(
  bankPool: BankCreditRecord[],
  settlementPool: SettlementRecord[],
): {
  matches: MatchResult[];
  remainingBank: BankCreditRecord[];
  remainingSettlements: SettlementRecord[];
} {
  const usedSettlement = new Set<string>();
  const matchedBank = new Set<string>();
  const matches: MatchResult[] = [];

  for (const bank of bankPool) {
    const hit = settlementPool.find(
      (s) =>
        !usedSettlement.has(s.settlementId) &&
        s.utr === bank.utr &&
        s.netAmount === bank.creditedAmount &&
        s.currency === bank.currency &&
        s.settledAt === bank.creditedAt,
    );
    if (!hit) continue;
    usedSettlement.add(hit.settlementId);
    matchedBank.add(bank.id);
    matches.push({
      bankCreditId: bank.id,
      settlementId: hit.settlementId,
      confidence: 1.0,
      matchedBy: "exact",
      reasoning: "Exact UTR, net/credited amount, currency, and date match",
    });
  }

  return {
    matches,
    remainingBank: bankPool.filter((b) => !matchedBank.has(b.id)),
    remainingSettlements: settlementPool.filter(
      (s) => !usedSettlement.has(s.settlementId),
    ),
  };
}

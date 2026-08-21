import { describe, expect, it } from "vitest";
import { exactMatch } from "../src/engine/exactMatch.js";
import type { BankCreditRecord, SettlementRecord } from "../src/data/types.js";

function bank(
  partial: Partial<BankCreditRecord> & Pick<BankCreditRecord, "id">,
): BankCreditRecord {
  return {
    utr: "UTR000001ABCDEF",
    creditedAmount: 1000,
    creditedAt: "2025-01-15",
    currency: "INR",
    ...partial,
  };
}

function settlement(
  partial: Partial<SettlementRecord> & Pick<SettlementRecord, "settlementId">,
): SettlementRecord {
  return {
    paymentId: "pay_0001",
    grossAmount: 1050,
    fee: 40,
    tax: 10,
    netAmount: 1000,
    settledAt: "2025-01-15",
    utr: "UTR000001ABCDEF",
    currency: "INR",
    ...partial,
  };
}

describe("exactMatch", () => {
  it("matches identical UTR, net/credited amount, currency, and date", () => {
    const result = exactMatch(
      [bank({ id: "B1" })],
      [settlement({ settlementId: "S1" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      bankCreditId: "B1",
      settlementId: "S1",
      confidence: 1,
      matchedBy: "exact",
    });
  });

  it("does not match when currency differs", () => {
    const result = exactMatch(
      [bank({ id: "B1", currency: "USD" })],
      [settlement({ settlementId: "S1", currency: "INR" })],
    );
    expect(result.matches).toHaveLength(0);
  });

  it("does not match when amount differs", () => {
    const result = exactMatch(
      [bank({ id: "B1", creditedAmount: 100 })],
      [settlement({ settlementId: "S1", netAmount: 100.5 })],
    );
    expect(result.matches).toHaveLength(0);
  });

  it("is greedy 1:1", () => {
    const result = exactMatch(
      [bank({ id: "B1" }), bank({ id: "B2" })],
      [settlement({ settlementId: "S1" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.remainingBank).toHaveLength(1);
  });
});

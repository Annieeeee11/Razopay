import { describe, expect, it } from "vitest";
import { findSubsetSums, splitMatch } from "../src/engine/splitMatch.js";
import type { BankCreditRecord, SettlementRecord } from "../src/data/types.js";

function bank(
  partial: Partial<BankCreditRecord> & Pick<BankCreditRecord, "id">,
): BankCreditRecord {
  return {
    utr: "UTRBATCH01",
    creditedAmount: 300,
    creditedAt: "2025-01-15",
    currency: "INR",
    ...partial,
  };
}

function settlement(
  partial: Partial<SettlementRecord> &
    Pick<SettlementRecord, "settlementId" | "netAmount" | "utr">,
): SettlementRecord {
  return {
    paymentId: "pay_x",
    grossAmount: partial.netAmount + 20,
    fee: 15,
    tax: 5,
    settledAt: "2025-01-14",
    currency: "INR",
    ...partial,
  };
}

describe("findSubsetSums", () => {
  it("finds exact sum combination", () => {
    const sols = findSubsetSums([100, 200, 50], 300, 0.01, 6);
    expect(sols.length).toBeGreaterThanOrEqual(1);
    expect(sols.some((s) => s.length === 2)).toBe(true);
  });

  it("returns empty when no solution", () => {
    expect(findSubsetSums([10, 20, 30], 100, 0.01, 6)).toHaveLength(0);
  });
});

describe("splitMatch", () => {
  it("matches unique subset sum", () => {
    const result = splitMatch(
      [bank({ id: "B1", creditedAmount: 300, utr: "UTRBATCH01" })],
      [
        settlement({
          settlementId: "S1",
          netAmount: 100,
          utr: "UTRBATCH01_S1",
        }),
        settlement({
          settlementId: "S2",
          netAmount: 200,
          utr: "UTRBATCH01_S2",
        }),
        settlement({
          settlementId: "S3",
          netAmount: 50,
          utr: "OTHER",
        }),
      ],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matchedBy).toBe("split");
    expect(result.matches[0]?.components?.sort()).toEqual(["S1", "S2"]);
  });

  it("does not auto-resolve when multiple combinations fit", () => {
    const result = splitMatch(
      [bank({ id: "B1", creditedAmount: 300, utr: "UTRMULTI" })],
      [
        settlement({ settlementId: "S1", netAmount: 100, utr: "UTRMULTI_S1" }),
        settlement({ settlementId: "S2", netAmount: 200, utr: "UTRMULTI_S2" }),
        settlement({ settlementId: "S3", netAmount: 150, utr: "UTRMULTI_S3" }),
        settlement({ settlementId: "S4", netAmount: 150, utr: "UTRMULTI_S4" }),
      ],
    );
    // 100+200 and 150+150 both = 300 — route to LLM as ambiguous, do not auto-pick
    expect(result.matches).toHaveLength(0);
    expect(result.exceptions).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.kind).toBe("split");
    expect(result.ambiguous[0]?.splitOptions?.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves pool when no solution", () => {
    const result = splitMatch(
      [bank({ id: "B1", creditedAmount: 999, utr: "UTRNONE" })],
      [
        settlement({ settlementId: "S1", netAmount: 100, utr: "UTRNONE_S1" }),
        settlement({ settlementId: "S2", netAmount: 200, utr: "UTRNONE_S2" }),
      ],
    );
    expect(result.matches).toHaveLength(0);
    expect(result.remainingBank).toHaveLength(1);
  });
});

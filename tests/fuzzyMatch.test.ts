import { describe, expect, it } from "vitest";
import {
  fuzzyMatch,
  normalizeReference,
  referenceSimilarity,
} from "../src/engine/fuzzyMatch.js";
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

describe("referenceSimilarity", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeReference("utr-001 a")).toBe("UTR001A");
    expect(referenceSimilarity("UTR001A", "UTR-001A")).toBe(1);
  });

  it("scores truncated UTR prefixes (≥6 chars) at least 0.9", () => {
    expect(referenceSimilarity("UTRABC123456", "UTRABC123456XYZ")).toBeGreaterThanOrEqual(
      0.9,
    );
  });

  it("keeps Levenshtein for short prefixes (<6 chars)", () => {
    const sim = referenceSimilarity("UTRAB", "UTRABC123456");
    expect(sim).toBeLessThan(0.9);
  });

  it("does not boost non-prefix decoy-style UTR mangling to the prefix floor", () => {
    // Non-prefix mangling stays on pure Levenshtein (~0.66) — must not get the 0.9 prefix boost
    const sim = referenceSimilarity("UTRABCDEFGHJKLM", "UTRABCDEFGHXXXX");
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(0.75);
    expect(sim).toBeLessThan(0.9);
  });
});

describe("fuzzyMatch", () => {
  it("accepts date-shifted matches within ±3 days", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", creditedAt: "2025-01-15" })],
      [settlement({ settlementId: "S1", settledAt: "2025-01-17" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matchedBy).toBe("fuzzy");
  });

  it("accepts amount within tolerance", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", creditedAmount: 1000 })],
      [settlement({ settlementId: "S1", netAmount: 1010 })],
    );
    expect(result.matches).toHaveLength(1);
  });

  it("flags currency mismatch as exception", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", currency: "USD" })],
      [settlement({ settlementId: "S1", currency: "INR" })],
    );
    expect(result.matches).toHaveLength(0);
    expect(result.exceptions.some((e) => e.reason.includes("currency"))).toBe(
      true,
    );
  });

  it("leaves unmatched rows in remaining pools (no silent drop)", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", creditedAt: "2025-01-01", creditedAmount: 100 })],
      [
        settlement({
          settlementId: "S1",
          settledAt: "2025-02-01",
          netAmount: 5000,
        }),
      ],
    );
    expect(result.matches).toHaveLength(0);
    expect(result.remainingBank).toHaveLength(1);
    expect(result.remainingSettlements).toHaveLength(1);
  });
});

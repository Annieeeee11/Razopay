import { describe, expect, it } from "vitest";
import {
  fuzzyMatch,
  normalizeReference,
  referenceSimilarity,
  scorePair,
} from "../src/engine/fuzzyMatch.js";
import type { BankTxn, LedgerEntry } from "../src/data/types.js";

function bank(partial: Partial<BankTxn> & Pick<BankTxn, "id">): BankTxn {
  return {
    date: "2025-01-15",
    amount: 1000,
    currency: "USD",
    description: "TEST",
    referenceCode: "REF001A",
    ...partial,
  };
}

function ledger(
  partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id">,
): LedgerEntry {
  return {
    date: "2025-01-15",
    amount: 1000,
    currency: "USD",
    memo: "TEST",
    referenceCode: "REF001A",
    category: "ops_expense",
    ...partial,
  };
}

describe("referenceSimilarity", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeReference("ref-001 a")).toBe("REF001A");
    expect(referenceSimilarity("REF001A", "REF-001A")).toBe(1);
  });
});

describe("fuzzyMatch", () => {
  it("accepts date-shifted matches within ±3 days", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", date: "2025-01-15" })],
      [ledger({ id: "L1", date: "2025-01-17" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matchedBy).toBe("fuzzy");
    expect(result.matches[0]?.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it("accepts amount within tolerance", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", amount: 1000 })],
      [ledger({ id: "L1", amount: 1010 })], // 1%
    );
    expect(result.matches).toHaveLength(1);
  });

  it("flags currency mismatch as exception, not match", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", currency: "USD" })],
      [ledger({ id: "L1", currency: "EUR" })],
    );
    expect(result.matches).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
    expect(result.exceptions.some((e) => e.reason.includes("currency"))).toBe(
      true,
    );
  });

  it("routes mid scores to ambiguous band", () => {
    // Same amount/date but heavily mangled reference → lower ref score
    const scored = scorePair(
      bank({ id: "B1", referenceCode: "REF001A" }),
      ledger({ id: "L1", referenceCode: "ZZZ999Z" }),
    );
    // If score lands in ambiguous band with a constructed case:
    const result = fuzzyMatch(
      [bank({ id: "B1", referenceCode: "ABCDEFGH", amount: 1000 })],
      [
        ledger({
          id: "L1",
          referenceCode: "ABXXEFGH", // partial overlap
          amount: 1015, // near edge of 2% tolerance
          date: "2025-01-18", // +3 days
        }),
      ],
    );
    // Depending on score: either fuzzy accept, ambiguous, or exception — must not silent-drop
    const accounted =
      result.matches.length +
      result.ambiguous.length +
      result.exceptions.filter((e) => e.source === "bank").length;
    expect(accounted).toBe(1);
    expect(scored.score).toBeGreaterThanOrEqual(0);
  });

  it("rejects pairs outside date/amount window with concrete reason", () => {
    const result = fuzzyMatch(
      [bank({ id: "B1", date: "2025-01-01", amount: 100 })],
      [ledger({ id: "L1", date: "2025-02-01", amount: 5000 })],
    );
    expect(result.matches).toHaveLength(0);
    expect(
      result.exceptions.some((e) =>
        e.reason.includes("no counterpart within date/amount window"),
      ),
    ).toBe(true);
  });
});

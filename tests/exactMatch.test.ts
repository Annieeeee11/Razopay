import { describe, expect, it } from "vitest";
import { exactMatch } from "../src/engine/exactMatch.js";
import type { BankTxn, LedgerEntry } from "../src/data/types.js";

function bank(partial: Partial<BankTxn> & Pick<BankTxn, "id">): BankTxn {
  return {
    date: "2025-01-15",
    amount: 100,
    currency: "USD",
    description: "TEST",
    referenceCode: "REF001",
    ...partial,
  };
}

function ledger(
  partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id">,
): LedgerEntry {
  return {
    date: "2025-01-15",
    amount: 100,
    currency: "USD",
    memo: "TEST",
    referenceCode: "REF001",
    category: "ops_expense",
    ...partial,
  };
}

describe("exactMatch", () => {
  it("matches identical reference, amount, currency, and date", () => {
    const result = exactMatch(
      [bank({ id: "B1" })],
      [ledger({ id: "L1" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      bankId: "B1",
      ledgerId: "L1",
      confidence: 1,
      matchedBy: "exact",
    });
    expect(result.remainingBank).toHaveLength(0);
    expect(result.remainingLedger).toHaveLength(0);
  });

  it("does not match when currency differs", () => {
    const result = exactMatch(
      [bank({ id: "B1", currency: "USD" })],
      [ledger({ id: "L1", currency: "EUR" })],
    );
    expect(result.matches).toHaveLength(0);
    expect(result.remainingBank).toHaveLength(1);
    expect(result.remainingLedger).toHaveLength(1);
  });

  it("does not match when amount differs", () => {
    const result = exactMatch(
      [bank({ id: "B1", amount: 100 })],
      [ledger({ id: "L1", amount: 100.5 })],
    );
    expect(result.matches).toHaveLength(0);
  });

  it("is greedy 1:1 — one ledger cannot match two banks", () => {
    const result = exactMatch(
      [bank({ id: "B1" }), bank({ id: "B2" })],
      [ledger({ id: "L1" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.remainingBank).toHaveLength(1);
    expect(result.remainingLedger).toHaveLength(0);
  });
});

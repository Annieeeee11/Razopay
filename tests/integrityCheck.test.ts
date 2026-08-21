import { describe, expect, it } from "vitest";
import { integrityCheck } from "../src/engine/integrityCheck.js";
import type { PaymentRecord, SettlementRecord } from "../src/data/types.js";

describe("integrityCheck", () => {
  it("flags fee/tax miscalculation", () => {
    const payments: PaymentRecord[] = [
      {
        orderId: "o1",
        paymentId: "pay_1",
        amount: 1000,
        currency: "INR",
        status: "captured",
        createdAt: "2025-01-01",
      },
    ];
    const settlements: SettlementRecord[] = [
      {
        settlementId: "s1",
        paymentId: "pay_1",
        grossAmount: 1000,
        fee: 20,
        tax: 4,
        netAmount: 900, // wrong: should be 976
        settledAt: "2025-01-02",
        utr: "UTR1",
        currency: "INR",
      },
    ];
    const result = integrityCheck(payments, settlements);
    expect(result.flaggedSettlementIds.has("s1")).toBe(true);
    expect(result.exceptions[0]?.exceptionType).toBe("fee_tax_mismatch");
  });
});

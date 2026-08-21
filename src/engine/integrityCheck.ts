import type {
  Exception,
  PaymentRecord,
  SettlementRecord,
} from "../data/types.js";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pre-pass: payment↔settlement integrity.
 * Flags fee/tax identity failures and gross vs payment amount mismatches.
 * Does not perform bank matching.
 */
export function integrityCheck(
  payments: PaymentRecord[],
  settlements: SettlementRecord[],
): {
  exceptions: Exception[];
  flaggedSettlementIds: Set<string>;
} {
  const byPayment = new Map(payments.map((p) => [p.paymentId, p]));
  const exceptions: Exception[] = [];
  const flaggedSettlementIds = new Set<string>();

  for (const s of settlements) {
    const expectedNet = roundMoney(s.grossAmount - s.fee - s.tax);
    if (Math.abs(expectedNet - s.netAmount) > 0.01) {
      flaggedSettlementIds.add(s.settlementId);
      exceptions.push({
        recordId: s.settlementId,
        source: "settlement",
        reason: `fee/tax miscalculation: netAmount ${s.netAmount} ≠ gross(${s.grossAmount}) - fee(${s.fee}) - tax(${s.tax}) = ${expectedNet}`,
        exceptionType: "fee_tax_mismatch",
      });
      continue;
    }

    const pay = byPayment.get(s.paymentId);
    if (!pay) {
      flaggedSettlementIds.add(s.settlementId);
      exceptions.push({
        recordId: s.settlementId,
        source: "settlement",
        reason: `settlement paymentId ${s.paymentId} has no payment record`,
      });
      continue;
    }

    if (Math.abs(pay.amount - s.grossAmount) > 0.01) {
      flaggedSettlementIds.add(s.settlementId);
      exceptions.push({
        recordId: s.settlementId,
        source: "settlement",
        reason: `grossAmount ${s.grossAmount} does not match payment amount ${pay.amount}`,
      });
      continue;
    }

    if (pay.currency !== s.currency) {
      flaggedSettlementIds.add(s.settlementId);
      exceptions.push({
        recordId: s.settlementId,
        source: "settlement",
        reason: `currency mismatch between payment (${pay.currency}) and settlement (${s.currency})`,
        exceptionType: "currency_mismatch",
      });
    }
  }

  return { exceptions, flaggedSettlementIds };
}

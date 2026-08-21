import type {
  BankCreditRecord,
  Exception,
  MatchResult,
  PaymentRecord,
  ReconcileConfig,
  ReconcileResult,
  SettlementRecord,
} from "../data/types.js";
import { DEFAULT_CONFIG } from "./config.js";
import { exactMatch } from "./exactMatch.js";
import { fuzzyMatch } from "./fuzzyMatch.js";
import { integrityCheck } from "./integrityCheck.js";
import { llmResolve } from "./llmResolve.js";

/**
 * Orchestrates integrity → exact → fuzzy → LLM.
 * Batched payouts remain exceptions until Phase 4 split pass.
 */
export async function reconcile(
  payments: PaymentRecord[],
  settlements: SettlementRecord[],
  bankCredits: BankCreditRecord[],
  config: Partial<ReconcileConfig> = {},
): Promise<ReconcileResult> {
  const cfg: ReconcileConfig = { ...DEFAULT_CONFIG, ...config };
  const totalStart = performance.now();

  const integrity = integrityCheck(payments, settlements);
  const settlementPool = settlements.filter(
    (s) => !integrity.flaggedSettlementIds.has(s.settlementId),
  );

  const t0 = performance.now();
  const pass1 = exactMatch(bankCredits, settlementPool);
  const exactMs = performance.now() - t0;

  const t1 = performance.now();
  const pass2 = fuzzyMatch(
    pass1.remainingBank,
    pass1.remainingSettlements,
    cfg,
  );
  const fuzzyMs = performance.now() - t1;

  // Tag pending/batched-looking leftovers with clearer reasons where possible
  const refinedExceptions = pass2.exceptions.map((e) => {
    if (
      e.source === "settlement" &&
      e.reason === "no counterpart within date/amount window"
    ) {
      return {
        ...e,
        reason:
          "settlement present, bank credit missing (payout may be in transit)",
        exceptionType: "settlement_pending_bank" as const,
      };
    }
    if (
      e.source === "bank" &&
      e.reason === "no counterpart within date/amount window"
    ) {
      const credit = bankCredits.find((b) => b.id === e.recordId);
      const looksBatched =
        credit &&
        settlements.some((s) => s.utr.startsWith(`${credit.utr}_S`));
      if (looksBatched) {
        return {
          ...e,
          reason: "batched payout — awaiting split match",
          exceptionType: "batched_payout" as const,
        };
      }
      return {
        ...e,
        reason:
          "UTR present in bank feed but no matching settlement (unclaimed credit)",
        exceptionType: "unclaimed_bank_credit" as const,
      };
    }
    return e;
  });

  const t2 = performance.now();
  const pass3 = await llmResolve(pass2.ambiguous, { skipLlm: cfg.skipLlm });
  const llmMs = performance.now() - t2;

  const matches: MatchResult[] = [
    ...pass1.matches,
    ...pass2.matches,
    ...pass3.matches,
  ];

  const matchedBank = new Set(matches.map((m) => m.bankCreditId));
  const matchedSettlement = new Set(matches.map((m) => m.settlementId));
  for (const m of matches) {
    if (m.components) {
      for (const id of m.components) matchedSettlement.add(id);
    }
  }

  const exceptions: Exception[] = [
    ...integrity.exceptions,
    ...refinedExceptions.filter(
      (e) =>
        !(e.source === "bank" && matchedBank.has(e.recordId)) &&
        !(e.source === "settlement" && matchedSettlement.has(e.recordId)),
    ),
    ...pass3.exceptions.filter(
      (e) =>
        !(e.source === "bank" && matchedBank.has(e.recordId)) &&
        !(e.source === "settlement" && matchedSettlement.has(e.recordId)),
    ),
  ];

  const seen = new Set<string>();
  const deduped: Exception[] = [];
  for (const e of exceptions) {
    const key = `${e.source}:${e.recordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  for (const b of bankCredits) {
    if (matchedBank.has(b.id)) continue;
    const key = `bank:${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      recordId: b.id,
      source: "bank",
      reason: "unresolved after all passes — no counterpart found",
    });
  }
  for (const s of settlements) {
    if (matchedSettlement.has(s.settlementId)) continue;
    const key = `settlement:${s.settlementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      recordId: s.settlementId,
      source: "settlement",
      reason: "unresolved after all passes — no counterpart found",
    });
  }

  const totalMs = performance.now() - totalStart;

  return {
    matches,
    exceptions: deduped,
    ambiguousResolved: pass3.matches.length,
    timing: {
      exactMs: Number(exactMs.toFixed(3)),
      fuzzyMs: Number(fuzzyMs.toFixed(3)),
      splitMs: 0,
      llmMs: Number(llmMs.toFixed(3)),
      totalMs: Number(totalMs.toFixed(3)),
    },
    bankCount: bankCredits.length,
    settlementCount: settlements.length,
    paymentCount: payments.length,
  };
}

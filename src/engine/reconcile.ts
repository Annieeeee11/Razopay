import type {
  BankCreditRecord,
  Correction,
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
import { splitMatch } from "./splitMatch.js";

function reasonForLeftoverBank(
  bank: BankCreditRecord,
  settlements: SettlementRecord[],
): Exception {
  const looksBatched = settlements.some((s) =>
    s.utr.startsWith(`${bank.utr}_S`),
  );
  if (looksBatched) {
    return {
      recordId: bank.id,
      source: "bank",
      reason: "batched payout — no unique subset-sum within window",
      exceptionType: "batched_payout",
    };
  }
  return {
    recordId: bank.id,
    source: "bank",
    reason:
      "UTR present in bank feed but no matching settlement (unclaimed credit)",
    exceptionType: "unclaimed_bank_credit",
  };
}

function reasonForLeftoverSettlement(settlementId: string): Exception {
  return {
    recordId: settlementId,
    source: "settlement",
    reason:
      "settlement present, bank credit missing (payout may be in transit)",
    exceptionType: "settlement_pending_bank",
  };
}

/**
 * Orchestrates integrity → exact → fuzzy → split → LLM.
 */
export async function reconcile(
  payments: PaymentRecord[],
  settlements: SettlementRecord[],
  bankCredits: BankCreditRecord[],
  config: Partial<ReconcileConfig> = {},
  corrections: Correction[] = [],
): Promise<ReconcileResult> {
  const cfg: ReconcileConfig = { ...DEFAULT_CONFIG, ...config };
  const totalStart = performance.now();

  const rejected = new Set(
    corrections
      .filter((c) => c.decision === "reject")
      .map((c) => `${c.source}:${c.recordId}`),
  );
  const humanMatches: MatchResult[] = [];
  for (const c of corrections) {
    if (c.decision !== "accept" || !c.correctedMatchId) continue;
    humanMatches.push({
      bankCreditId:
        c.source === "bank" ? c.recordId : c.correctedMatchId,
      settlementId:
        c.source === "settlement" ? c.recordId : c.correctedMatchId,
      components: c.components,
      confidence: 1,
      matchedBy: "human",
      reasoning: "Accepted by human correction",
    });
  }
  const humanBank = new Set(humanMatches.map((m) => m.bankCreditId));
  const humanSettlement = new Set(
    humanMatches.flatMap((m) => m.components ?? [m.settlementId]),
  );

  const integrity = integrityCheck(payments, settlements);
  const settlementPool = settlements.filter(
    (s) =>
      !integrity.flaggedSettlementIds.has(s.settlementId) &&
      !humanSettlement.has(s.settlementId) &&
      !rejected.has(`settlement:${s.settlementId}`),
  );
  const bankPool = bankCredits.filter(
    (b) => !humanBank.has(b.id) && !rejected.has(`bank:${b.id}`),
  );

  const t0 = performance.now();
  const pass1 = exactMatch(bankPool, settlementPool);
  const exactMs = performance.now() - t0;

  const t1 = performance.now();
  const pass2 = fuzzyMatch(
    pass1.remainingBank,
    pass1.remainingSettlements,
    cfg,
  );
  const fuzzyMs = performance.now() - t1;

  const tSplit = performance.now();
  const passSplit = splitMatch(
    pass2.remainingBank,
    pass2.remainingSettlements,
    cfg,
  );
  const splitMs = performance.now() - tSplit;

  const t2 = performance.now();
  const pass3 = await llmResolve(pass2.ambiguous, {
    skipLlm: cfg.skipLlm,
    llmProvider: cfg.llmProvider,
    llmModel: cfg.llmModel,
  });
  const llmMs = performance.now() - t2;

  const matches: MatchResult[] = [
    ...humanMatches,
    ...pass1.matches,
    ...pass2.matches,
    ...passSplit.matches,
    ...pass3.matches,
  ];

  const matchedBank = new Set(matches.map((m) => m.bankCreditId));
  const matchedSettlement = new Set<string>();
  for (const m of matches) {
    matchedSettlement.add(m.settlementId);
    if (m.components) {
      for (const id of m.components) matchedSettlement.add(id);
    }
  }

  const leftoverExceptions: Exception[] = [];
  for (const b of passSplit.remainingBank) {
    if (matchedBank.has(b.id)) continue;
    leftoverExceptions.push(reasonForLeftoverBank(b, settlements));
  }
  for (const s of passSplit.remainingSettlements) {
    if (matchedSettlement.has(s.settlementId)) continue;
    leftoverExceptions.push(reasonForLeftoverSettlement(s.settlementId));
  }

  // Permanent rejects from human corrections
  for (const c of corrections) {
    if (c.decision !== "reject") continue;
    leftoverExceptions.push({
      recordId: c.recordId,
      source: c.source,
      reason: "permanently rejected by human correction",
    });
  }

  const exceptions: Exception[] = [
    ...integrity.exceptions,
    ...pass2.exceptions,
    ...passSplit.exceptions,
    ...pass3.exceptions,
    ...leftoverExceptions,
  ].filter(
    (e) =>
      !(e.source === "bank" && matchedBank.has(e.recordId)) &&
      !(e.source === "settlement" && matchedSettlement.has(e.recordId)),
  );

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
    deduped.push(reasonForLeftoverBank(b, settlements));
  }
  for (const s of settlements) {
    if (matchedSettlement.has(s.settlementId)) continue;
    const key = `settlement:${s.settlementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(reasonForLeftoverSettlement(s.settlementId));
  }

  const totalMs = performance.now() - totalStart;

  return {
    matches,
    exceptions: deduped,
    ambiguousResolved: pass3.matches.length,
    timing: {
      exactMs: Number(exactMs.toFixed(3)),
      fuzzyMs: Number(fuzzyMs.toFixed(3)),
      splitMs: Number(splitMs.toFixed(3)),
      llmMs: Number(llmMs.toFixed(3)),
      totalMs: Number(totalMs.toFixed(3)),
    },
    bankCount: bankCredits.length,
    settlementCount: settlements.length,
    paymentCount: payments.length,
  };
}

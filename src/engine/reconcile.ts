import type {
  BankTxn,
  Exception,
  LedgerEntry,
  MatchResult,
  ReconcileConfig,
  ReconcileResult,
} from "../data/types.js";
import { DEFAULT_CONFIG } from "./config.js";
import { exactMatch } from "./exactMatch.js";
import { fuzzyMatch } from "./fuzzyMatch.js";
import { llmResolve } from "./llmResolve.js";

/**
 * Orchestrates exact → fuzzy → LLM passes.
 * Every record ends as a match or a reasoned exception.
 */
export async function reconcile(
  bank: BankTxn[],
  ledger: LedgerEntry[],
  config: Partial<ReconcileConfig> = {},
): Promise<ReconcileResult> {
  const cfg: ReconcileConfig = { ...DEFAULT_CONFIG, ...config };
  const totalStart = performance.now();

  const t0 = performance.now();
  const pass1 = exactMatch(bank, ledger);
  const exactMs = performance.now() - t0;

  const t1 = performance.now();
  const pass2 = fuzzyMatch(pass1.remainingBank, pass1.remainingLedger, cfg);
  const fuzzyMs = performance.now() - t1;

  // Ambiguous pairs are held out of pass2 exceptions; resolve via LLM (or flag)
  const t2 = performance.now();
  const pass3 = await llmResolve(pass2.ambiguous, { skipLlm: cfg.skipLlm });
  const llmMs = performance.now() - t2;

  const matches: MatchResult[] = [
    ...pass1.matches,
    ...pass2.matches,
    ...pass3.matches,
  ];

  // Remove exceptions for records that LLM matched
  const matchedBank = new Set(matches.map((m) => m.bankId));
  const matchedLedger = new Set(matches.map((m) => m.ledgerId));

  const exceptions: Exception[] = [
    ...pass2.exceptions.filter(
      (e) =>
        !(e.source === "bank" && matchedBank.has(e.recordId)) &&
        !(e.source === "ledger" && matchedLedger.has(e.recordId)),
    ),
    ...pass3.exceptions.filter(
      (e) =>
        !(e.source === "bank" && matchedBank.has(e.recordId)) &&
        !(e.source === "ledger" && matchedLedger.has(e.recordId)),
    ),
  ];

  // Deduplicate exceptions by source+recordId (keep first reason)
  const seen = new Set<string>();
  const deduped: Exception[] = [];
  for (const e of exceptions) {
    const key = `${e.source}:${e.recordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  // Safety: any still-unaccounted records become exceptions (should not happen)
  for (const b of bank) {
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
  for (const l of ledger) {
    if (matchedLedger.has(l.id)) continue;
    const key = `ledger:${l.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      recordId: l.id,
      source: "ledger",
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
      llmMs: Number(llmMs.toFixed(3)),
      totalMs: Number(totalMs.toFixed(3)),
    },
    bankCount: bank.length,
    ledgerCount: ledger.length,
  };
}

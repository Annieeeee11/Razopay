export interface PaymentRecord {
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: "captured" | "failed" | "refunded";
  createdAt: string; // YYYY-MM-DD
}

export interface SettlementRecord {
  settlementId: string;
  paymentId: string;
  grossAmount: number;
  fee: number;
  tax: number;
  netAmount: number;
  settledAt: string; // YYYY-MM-DD
  utr: string;
  currency: string;
}

export interface BankCreditRecord {
  id: string;
  utr: string;
  creditedAmount: number;
  creditedAt: string; // YYYY-MM-DD
  currency: string;
}

export type GroundTruthLabelKind = "match" | "exception";

export type DiscrepancyClass =
  | "clean"
  | "date_shifted"
  | "amount_shifted"
  | "reference_mangled"
  | "duplicate_bank"
  | "currency_mismatch"
  | "fee_tax_mismatch"
  | "settlement_pending_bank"
  | "unclaimed_bank_credit"
  | "batched_payout";

export interface GroundTruthLabel {
  bankCreditId: string | null;
  settlementId: string | null;
  /** For batched_payout true matches: all settlement IDs in the batch */
  settlementIds?: string[];
  paymentId?: string | null;
  label: GroundTruthLabelKind;
  exceptionType?: DiscrepancyClass;
  class?: DiscrepancyClass;
}

export type MatchSource = "exact" | "fuzzy" | "llm" | "split" | "human";

export interface MatchResult {
  bankCreditId: string;
  settlementId: string;
  /** Present for split / batched matches */
  components?: string[];
  confidence: number;
  matchedBy: MatchSource;
  reasoning?: string;
}

export type ExceptionSource = "payment" | "settlement" | "bank";

export interface Exception {
  recordId: string;
  source: ExceptionSource;
  reason: string;
  exceptionType?: DiscrepancyClass;
}

export interface AmbiguousCandidate {
  bank: BankCreditRecord;
  settlement: SettlementRecord;
  score: number;
  reasoning: string;
}

export interface PassTiming {
  exactMs: number;
  fuzzyMs: number;
  splitMs: number;
  llmMs: number;
  totalMs: number;
}

export interface ReconcileResult {
  matches: MatchResult[];
  exceptions: Exception[];
  ambiguousResolved: number;
  timing: PassTiming;
  bankCount: number;
  settlementCount: number;
  paymentCount: number;
}

export interface ReconcileConfig {
  dateWindowDays: number;
  amountTolerancePct: number;
  amountToleranceAbs: number;
  fuzzyAcceptThreshold: number;
  ambiguousLow: number;
  ambiguousHigh: number;
  weightAmount: number;
  weightDate: number;
  weightReference: number;
  skipLlm: boolean;
  splitDateWindowDays: number;
  splitMaxPool: number;
  splitMaxCombo: number;
  llmProvider?: "anthropic" | "ollama" | "none";
  llmModel?: string;
  applyCorrections?: boolean;
}

export interface MatchSourceBreakdown {
  exact: number;
  fuzzy: number;
  split: number;
  llm: number;
  human: number;
}

export interface ScoreReport {
  matchRate: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  exceptionAccuracy: number;
  trueMatchCount: number;
  predictedMatchCount: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueExceptionCount: number;
  predictedExceptionCount: number;
  correctlyFlaggedExceptions: number;
  throughputRecordsPerSec: number;
  timing: PassTiming;
  matchSourceBreakdown: MatchSourceBreakdown;
  bankCount: number;
  settlementCount: number;
  paymentCount: number;
  seed: number;
  llmEnabled: boolean;
  llmProvider?: string;
  suggestedFuzzyThreshold?: number;
}

export interface Correction {
  recordId: string;
  source: ExceptionSource;
  decision: "accept" | "reject";
  correctedMatchId?: string;
  components?: string[];
  score?: number;
  ts: string;
}

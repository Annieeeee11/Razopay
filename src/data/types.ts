export interface BankTxn {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  description: string;
  referenceCode: string;
}

export interface LedgerEntry {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  memo: string;
  referenceCode: string;
  category: string;
}

export type GroundTruthLabelKind = "match" | "exception";

export type DiscrepancyClass =
  | "clean"
  | "date_shifted"
  | "amount_shifted"
  | "reference_mangled"
  | "duplicate_bank"
  | "missing_in_ledger"
  | "missing_in_bank"
  | "currency_mismatch";

export interface GroundTruthLabel {
  bankId: string | null;
  ledgerId: string | null;
  label: GroundTruthLabelKind;
  exceptionType?: DiscrepancyClass;
  class?: DiscrepancyClass;
}

export type MatchSource = "exact" | "fuzzy" | "llm";

export interface MatchResult {
  bankId: string;
  ledgerId: string;
  confidence: number;
  matchedBy: MatchSource;
  reasoning?: string;
}

export type ExceptionSource = "bank" | "ledger";

export interface Exception {
  recordId: string;
  source: ExceptionSource;
  reason: string;
}

export interface AmbiguousCandidate {
  bank: BankTxn;
  ledger: LedgerEntry;
  score: number;
  reasoning: string;
}

export interface PassTiming {
  exactMs: number;
  fuzzyMs: number;
  llmMs: number;
  totalMs: number;
}

export interface ReconcileResult {
  matches: MatchResult[];
  exceptions: Exception[];
  ambiguousResolved: number;
  timing: PassTiming;
  bankCount: number;
  ledgerCount: number;
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
}

export interface MatchSourceBreakdown {
  exact: number;
  fuzzy: number;
  llm: number;
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
  ledgerCount: number;
  seed: number;
  llmEnabled: boolean;
}

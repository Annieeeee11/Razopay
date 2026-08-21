export interface ScoreReport {
  matchRate: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  exceptionAccuracy: number;
  throughputRecordsPerSec: number;
  timing: {
    exactMs: number;
    fuzzyMs: number;
    splitMs: number;
    llmMs: number;
    totalMs: number;
  };
  matchSourceBreakdown: {
    exact: number;
    fuzzy: number;
    split: number;
    llm: number;
    human: number;
  };
  bankCount: number;
  settlementCount: number;
  paymentCount: number;
  seed: number;
  llmEnabled: boolean;
  llmProvider?: string;
}

export interface MatchResult {
  bankCreditId: string;
  settlementId: string;
  components?: string[];
  confidence: number;
  matchedBy: string;
  reasoning?: string;
}

export interface Exception {
  recordId: string;
  source: string;
  reason: string;
  exceptionType?: string;
}

export interface FullReport {
  metrics: ScoreReport;
  matches: MatchResult[];
  exceptions: Exception[];
  knownLimitations: string[];
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export type AmbiguityLevel = "clear" | "boundary" | "decoy" | "unresolvable";

export interface AmbiguitySlice {
  matchRate: number;
  precision: number;
  recall: number;
  trueMatchCount: number;
  predictedMatchCount: number;
  truePositive: number;
  falsePositive: number;
  correctlyDeferred?: number;
  deferredTotal?: number;
  notes: string;
}

export interface LlmAblation {
  providerAvailable: boolean;
  withLlm: {
    matchRate: number;
    precision: number;
    recall: number;
    falsePositiveRate: number;
    llmMatches: number;
    provider: string;
  };
  withoutLlm: {
    matchRate: number;
    precision: number;
    recall: number;
    falsePositiveRate: number;
    llmMatches: number;
  };
}

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
  byAmbiguityLevel?: Record<AmbiguityLevel, AmbiguitySlice>;
  llmAblation?: LlmAblation;
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
  relatedIds?: string[];
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

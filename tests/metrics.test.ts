import { describe, expect, it } from "vitest";
import { scoreMatches } from "../src/scoring/metrics.js";
import type {
  Exception,
  GroundTruthLabel,
  MatchResult,
} from "../src/data/types.js";

const timing = {
  exactMs: 1,
  fuzzyMs: 2,
  splitMs: 0,
  llmMs: 0,
  totalMs: 3,
};

describe("metrics", () => {
  const groundTruth: GroundTruthLabel[] = [
    {
      bankCreditId: "B1",
      settlementId: "S1",
      label: "match",
      class: "clean",
    },
    {
      bankCreditId: "B2",
      settlementId: "S2",
      label: "match",
      class: "clean",
    },
    {
      bankCreditId: "B3",
      settlementId: null,
      label: "exception",
      exceptionType: "unclaimed_bank_credit",
    },
    {
      bankCreditId: null,
      settlementId: "S3",
      label: "exception",
      exceptionType: "settlement_pending_bank",
    },
  ];

  it("computes precision, recall, and FP rate separately", () => {
    const matches: MatchResult[] = [
      { bankCreditId: "B1", settlementId: "S1", confidence: 1, matchedBy: "exact" },
      { bankCreditId: "B3", settlementId: "S3", confidence: 0.8, matchedBy: "fuzzy" },
    ];
    const exceptions: Exception[] = [
      { recordId: "B2", source: "bank", reason: "missed" },
      { recordId: "S2", source: "settlement", reason: "missed" },
      { recordId: "S3", source: "settlement", reason: "no bank" },
    ];

    const report = scoreMatches(matches, exceptions, groundTruth, {
      bankCount: 3,
      settlementCount: 3,
      paymentCount: 3,
      timing,
      seed: 1,
      llmEnabled: false,
    });

    expect(report.truePositive).toBe(1);
    expect(report.falsePositive).toBe(1);
    expect(report.falseNegative).toBe(1);
    expect(report.precision).toBeCloseTo(0.5);
    expect(report.recall).toBeCloseTo(0.5);
    expect(report.falsePositiveRate).toBeCloseTo(0.5);
  });

  it("scores perfect prediction", () => {
    const matches: MatchResult[] = [
      { bankCreditId: "B1", settlementId: "S1", confidence: 1, matchedBy: "exact" },
      { bankCreditId: "B2", settlementId: "S2", confidence: 1, matchedBy: "exact" },
    ];
    const exceptions: Exception[] = [
      { recordId: "B3", source: "bank", reason: "unclaimed" },
      { recordId: "S3", source: "settlement", reason: "pending" },
    ];
    const report = scoreMatches(matches, exceptions, groundTruth, {
      bankCount: 3,
      settlementCount: 3,
      paymentCount: 3,
      timing,
      seed: 1,
      llmEnabled: false,
    });
    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    expect(report.falsePositiveRate).toBe(0);
    expect(report.exceptionAccuracy).toBe(1);
  });
});

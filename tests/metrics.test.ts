import { describe, expect, it } from "vitest";
import { scoreMatches } from "../src/scoring/metrics.js";
import type {
  Exception,
  GroundTruthLabel,
  MatchResult,
} from "../src/data/types.js";

const timing = { exactMs: 1, fuzzyMs: 2, llmMs: 0, totalMs: 3 };

describe("metrics", () => {
  const groundTruth: GroundTruthLabel[] = [
    { bankId: "B1", ledgerId: "L1", label: "match", class: "clean" },
    { bankId: "B2", ledgerId: "L2", label: "match", class: "clean" },
    {
      bankId: "B3",
      ledgerId: null,
      label: "exception",
      exceptionType: "missing_in_ledger",
    },
    {
      bankId: null,
      ledgerId: "L3",
      label: "exception",
      exceptionType: "missing_in_bank",
    },
  ];

  it("computes precision, recall, and FP rate separately", () => {
    const matches: MatchResult[] = [
      { bankId: "B1", ledgerId: "L1", confidence: 1, matchedBy: "exact" },
      { bankId: "B3", ledgerId: "L3", confidence: 0.8, matchedBy: "fuzzy" }, // FP
    ];
    const exceptions: Exception[] = [
      { recordId: "B2", source: "bank", reason: "missed" },
      { recordId: "L2", source: "ledger", reason: "missed" },
      {
        recordId: "B3",
        source: "bank",
        reason: "wrongly also excepted? shouldn't",
      },
    ];

    // Fix: B3 was matched so shouldn't be in exceptions for this toy — use clean set
    const cleanExceptions: Exception[] = [
      { recordId: "B2", source: "bank", reason: "missed" },
      { recordId: "L2", source: "ledger", reason: "missed" },
      { recordId: "L3", source: "ledger", reason: "no bank" },
    ];

    const report = scoreMatches(matches, cleanExceptions, groundTruth, {
      bankCount: 3,
      ledgerCount: 3,
      timing,
      seed: 1,
      llmEnabled: false,
    });

    // TP=1 (B1-L1), FP=1 (B3-L3), FN=1 (B2-L2)
    expect(report.truePositive).toBe(1);
    expect(report.falsePositive).toBe(1);
    expect(report.falseNegative).toBe(1);
    expect(report.precision).toBeCloseTo(0.5);
    expect(report.recall).toBeCloseTo(0.5);
    expect(report.falsePositiveRate).toBeCloseTo(0.5);
    expect(report.matchRate).toBe(report.recall);
    void exceptions;
  });

  it("scores perfect prediction", () => {
    const matches: MatchResult[] = [
      { bankId: "B1", ledgerId: "L1", confidence: 1, matchedBy: "exact" },
      { bankId: "B2", ledgerId: "L2", confidence: 1, matchedBy: "exact" },
    ];
    const exceptions: Exception[] = [
      { recordId: "B3", source: "bank", reason: "missing_in_ledger" },
      { recordId: "L3", source: "ledger", reason: "missing_in_bank" },
    ];
    const report = scoreMatches(matches, exceptions, groundTruth, {
      bankCount: 3,
      ledgerCount: 3,
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

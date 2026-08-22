import { describe, expect, it } from "vitest";
import { generateDataset } from "../src/data/generate.js";
import type { AmbiguityLevel } from "../src/data/types.js";
import { reconcile } from "../src/engine/reconcile.js";
import { scoreAgainstGroundTruth } from "../src/scoring/metrics.js";

const LEVELS: AmbiguityLevel[] = [
  "clear",
  "boundary",
  "decoy",
  "unresolvable",
];

describe("reconcile e2e (seed 42, skip-llm)", () => {
  it("meets baseline gates and reports each difficulty slice", async () => {
    const dataset = generateDataset(42);
    const result = await reconcile(
      dataset.payments,
      dataset.settlements,
      dataset.bankCredits,
      { skipLlm: true, seed: 42 },
    );
    const metrics = scoreAgainstGroundTruth(
      result,
      dataset.groundTruth,
      42,
      false,
      "none",
    );

    expect(metrics.precision).toBeGreaterThanOrEqual(0.9);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.88);
    expect(metrics.falsePositiveRate).toBeLessThanOrEqual(0.05);

    for (const level of LEVELS) {
      const slice = metrics.byAmbiguityLevel[level];
      expect(slice, `missing slice ${level}`).toBeDefined();
      expect(typeof slice.matchRate).toBe("number");
      expect(typeof slice.precision).toBe("number");
      expect(typeof slice.recall).toBe("number");
    }
  });
});

import type { ReconcileConfig } from "../data/types.js";

export const DEFAULT_CONFIG: ReconcileConfig = {
  dateWindowDays: 3,
  amountTolerancePct: 0.02,
  amountToleranceAbs: 0.5,
  fuzzyAcceptThreshold: 0.75,
  ambiguousLow: 0.5,
  ambiguousHigh: 0.75,
  weightAmount: 0.4,
  weightDate: 0.3,
  weightReference: 0.3,
  skipLlm: false,
  splitDateWindowDays: 5,
  splitMaxPool: 25,
  splitMaxCombo: 6,
};

export function amountTolerance(
  amount: number,
  config: ReconcileConfig = DEFAULT_CONFIG,
): number {
  return Math.max(
    Math.abs(amount) * config.amountTolerancePct,
    config.amountToleranceAbs,
  );
}

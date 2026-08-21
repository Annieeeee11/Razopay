import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Correction } from "../data/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const CORRECTIONS_PATH = join(ROOT, "output", "corrections.json");

export function loadCorrections(
  path: string = CORRECTIONS_PATH,
): Correction[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Correction[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * If humans consistently accept scores in 0.65–0.75, suggest lowering
 * fuzzyAcceptThreshold. Logged only — never applied silently.
 */
export function suggestFuzzyThreshold(
  corrections: Correction[],
): number | undefined {
  const accepts = corrections.filter(
    (c) =>
      c.decision === "accept" &&
      typeof c.score === "number" &&
      c.score >= 0.65 &&
      c.score < 0.75,
  );
  if (accepts.length < 3) return undefined;
  const avg =
    accepts.reduce((s, c) => s + (c.score ?? 0), 0) / accepts.length;
  return Number(Math.max(0.5, avg - 0.05).toFixed(2));
}

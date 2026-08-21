import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(
  readFileSync(join(root, "baselines/seed42.json"), "utf8"),
);
const report = JSON.parse(
  readFileSync(join(root, "output/report.json"), "utf8"),
);
const m = report.metrics;

const checks = [
  ["precision", m.precision, baseline.minPrecision, ">="],
  ["recall", m.recall, baseline.minRecall, ">="],
  ["matchRate", m.matchRate, baseline.minMatchRate, ">="],
  ["falsePositiveRate", m.falsePositiveRate, baseline.maxFalsePositiveRate, "<="],
];

let failed = false;
for (const [name, actual, bound, op] of checks) {
  const ok = op === ">=" ? actual >= bound : actual <= bound;
  const line = `${name}=${actual} ${op} ${bound} → ${ok ? "ok" : "FAIL"}`;
  console.log(line);
  if (!ok) failed = true;
}

if (failed) {
  console.error("Baseline regression detected.");
  process.exit(1);
}
console.log("Baseline checks passed.");

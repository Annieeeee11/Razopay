# AI Finance Controller — Multi-source Reconciliation

Match a **bank statement** against an **internal ledger**, score against known ground truth, and emit a reasoned exception list.

## Quick start

```bash
npm install
npm run reconcile -- --seed 42
```

Outputs:
- `data/bank_statement.json`, `data/internal_ledger.json`, `data/ground_truth.json`
- `output/report.json`, `output/report.md` (also printed to stdout)

### Options

| Flag | Meaning |
| --- | --- |
| `--seed <n>` | Reproducible synthetic batch (default `42`) |
| `--generate-only` | Write data files and exit |
| `--skip-llm` | Never call the LLM, even if `ANTHROPIC_API_KEY` is set |

### Optional LLM pass

Ambiguous pairs only (scores 0.50–0.75 after fuzzy). Set:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run reconcile -- --seed 42
```

Without a key, ambiguous rows become exceptions with reason `ambiguous — LLM unavailable`.

## What the numbers mean

Reported **separately** (no blended “accuracy %”):

| Metric | Meaning |
| --- | --- |
| **Match rate / Recall** | Of true matches in ground truth, % the engine found |
| **Precision** | Of pairs the engine called a match, % that are correct |
| **False positive rate** | Of predicted matches, % that are wrong (controller risk) |
| **Exception accuracy** | Of records flagged as exceptions, % that are true exceptions |
| **Throughput** | `(bank + ledger) records / total seconds` |

Match-source breakdown shows how many pairs came from **exact**, **fuzzy**, and **LLM**.

## Pipeline

1. **Generate** — seeded synthetic bank + ledger (≥50 each) with deliberate discrepancy classes and ground-truth labels
2. **Exact match** — same reference, amount, currency, date
3. **Fuzzy match** — ±3 day window, amount tolerance max(2%, $0.50), normalized Levenshtein on references; accept ≥0.75; 0.50–0.75 → ambiguous
4. **LLM (optional)** — ambiguous bucket only
5. **Score + report** — full batch vs ground truth; every unmatched row gets a specific reason

## Tests

```bash
npm test
```

## Known limitations

- 1:1 matching only (no multi-to-one / one-to-many)
- No partial or split payments
- No FX conversion — currency mismatches are never auto-matched
- Description/memo is not a primary matching signal
- Duplicates: first claim wins; extras become exceptions

## Non-negotiables

- Full generated batch is scored — no cherry-picked subset
- Exceptions always include a concrete reason
- Precision, recall, and FP rate are reported separately
- Seeded generation is reproducible

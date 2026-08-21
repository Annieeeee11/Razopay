# Razopay — Payment Gateway Settlement Reconciliation

Reconciles Razorpay-style **3-way settlement flow**:

1. **Payments** (orders captured on the gateway)
2. **Settlements** (gross / fee / tax / net + UTR)
3. **Bank payout credits** (UTR join on net amount)

Deterministic passes (exact → fuzzy → split) resolve the majority of rows. Optional LLM handles the ambiguous residual. Batched payouts (one bank credit = sum of settlement nets) are matched via bounded subset-sum.

## Quick start

```bash
npm install
npm run reconcile -- --seed 42 --skip-llm
```

Outputs:
- `data/payments.json`, `data/settlements.json`, `data/bank_credits.json`, `data/ground_truth.json`
- `output/report.json`, `output/report.md`

### Options

| Flag | Meaning |
| --- | --- |
| `--seed <n>` | Reproducible synthetic batch (default `42`) |
| `--generate-only` | Write data files and exit |
| `--skip-llm` | Force no LLM |
| `--llm-provider <…>` | `anthropic` \| `ollama` \| `none` |
| `--llm-model <name>` | Ollama model name (default `llama3.2`) |
| `--apply-corrections` | Apply human corrections from `output/corrections.json` |

### Optional LLM pass (BYOK / local)

Selection order: `--llm-provider` → `ANTHROPIC_API_KEY` → Ollama at `localhost:11434` → none.

```bash
# No key required — skip LLM entirely
npm run reconcile -- --seed 42 --skip-llm

# Anthropic BYOK
export ANTHROPIC_API_KEY=sk-ant-...
npm run reconcile -- --seed 42 --llm-provider anthropic

# Local Ollama (zero cloud cost)
ollama serve   # separate terminal
npm run reconcile -- --seed 42 --llm-provider ollama --llm-model llama3.2
```

Before any calls the CLI prints: `LLM pass: N ambiguous pairs, provider=<x>, est. calls=N`.

## Human corrections

In the dashboard, Accept / Reject on exception rows writes `output/corrections.json`.
Re-run with overrides:

```bash
npm run reconcile -- --seed 42 --skip-llm --apply-corrections
```

Accepted pairs become `matchedBy: human`. Rejected IDs stay permanent exceptions.
If ≥3 accepts fall in score band 0.65–0.75, the report **logs** a suggested fuzzy threshold (never auto-applied).

Local visualization over `output/report.json` (CLI remains source of truth):

```bash
npm run reconcile -- --seed 42 --skip-llm
npm run dashboard
# open http://localhost:5173
```

## Metrics (never blended)

| Metric | Meaning |
| --- | --- |
| **Match rate / Recall** | Of true matches, % found |
| **Precision** | Of predicted matches, % correct |
| **False positive rate** | Of predicted matches, % wrong |
| **Exception accuracy** | Of flagged exceptions, % that are true exceptions |
| **Throughput** | records/sec |

## Tests

```bash
npm test
```

## Known limitations

- Split matching is bounded (pool ≤25, combo ≤6) for demo scale
- Ambiguous multi-solution batches are not auto-picked
- No FX conversion
- Duplicate bank credits: first claim wins

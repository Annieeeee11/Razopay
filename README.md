# Razopay — Payment Gateway Settlement Reconciliation

Reconciles Razorpay-style **3-way settlement flow**:

1. **Payments** (orders captured on the gateway)
2. **Settlements** (gross / fee / tax / net + UTR)
3. **Bank payout credits** (UTR join on net amount)

Deterministic passes (exact → fuzzy) resolve the majority of 1:1 rows. Optional LLM handles the ambiguous residual. Batched payouts are generated as ground truth and left as reasoned exceptions until the split-match pass lands.

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

- Batched payouts (one bank credit = sum of several settlement nets) are in the dataset but not auto-resolved yet
- No FX conversion
- 1:1 matching for non-batched rows

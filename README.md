# Razopay — Payment Gateway Settlement Reconciliation

Razorpay-shaped **3-way settlement reconciliation**: Payments → Settlements (gross/fee/tax/net + UTR) → Bank payout credits. Deterministic exact → fuzzy → split passes resolve the batch; optional BYOK/Ollama LLM and human corrections handle the residual.

**Seed 42 headline metrics** (`npm run reconcile -- --seed 42 --skip-llm`):

| Precision | Recall | FP rate | Split matches |
| ---: | ---: | ---: | ---: |
| 100% | 100% | 0% | 3 |

```bash
npm install
npm run reconcile -- --seed 42 --skip-llm
npm run dashboard   # http://localhost:5173 — local viz over output/report.json
```

Docker (zero local setup):

```bash
docker build -t razopay .
docker run --rm razopay
```

---

## Pipeline

1. **Payments** — gateway order/payment captures  
2. **Settlements** — fee/tax identity + UTR  
3. **Bank credits** — UTR join on `creditedAmount` ≈ `netAmount`  
4. Passes: integrity → exact → fuzzy → **split** (batched payouts) → LLM → human corrections  

## Quick start

```bash
npm install
npm run reconcile -- --seed 42 --skip-llm
```

Outputs: `data/*.json`, `output/report.json`, `output/report.md` (also copied to `dashboard/public/report.json`).

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
npm run reconcile -- --seed 42 --skip-llm
export ANTHROPIC_API_KEY=sk-ant-...
npm run reconcile -- --seed 42 --llm-provider anthropic
npm run reconcile -- --seed 42 --llm-provider ollama --llm-model llama3.2
```

Before calls: `LLM pass: N ambiguous pairs, provider=<x>, est. calls=N`.

## Human corrections

Dashboard Accept / Reject → `output/corrections.json`. Re-apply:

```bash
npm run reconcile -- --seed 42 --skip-llm --apply-corrections
```

## Dashboard

```bash
npm run reconcile -- --seed 42 --skip-llm
npm run dashboard
```

CLI is the source of truth; the dashboard is a local visualization layer.

## Metrics (never blended)

| Metric | Meaning |
| --- | --- |
| **Match rate / Recall** | Of true matches, % found |
| **Precision** | Of predicted matches, % correct |
| **False positive rate** | Of predicted matches, % wrong |
| **Exception accuracy** | Of flagged exceptions, % that are true exceptions |
| **Throughput** | records/sec |

## Tests & CI

```bash
npm test
npm run reconcile -- --seed 42 --skip-llm
npm run check-baseline
```

CI runs the same on every push and fails if precision/recall regress below `baselines/seed42.json`.

## Known limitations

- Split matching is bounded (pool ≤25, combo ≤6) for demo scale
- Ambiguous multi-solution batches are not auto-picked
- No FX conversion
- Duplicate bank credits: first claim wins

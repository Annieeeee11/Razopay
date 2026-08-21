# Razopay — Payment Gateway Settlement Reconciliation

Razorpay-shaped **3-way settlement reconciliation**: Payments → Settlements (gross/fee/tax/net + UTR) → Bank payout credits. Deterministic exact → fuzzy → split passes resolve most of the batch; adversarial near-duplicates and boundary UTR mangles feed the LLM/human residual.

**Seed 42 headline metrics** (`npm run reconcile -- --seed 42 --skip-llm`):

| Precision | Recall | FP rate | Exact / Fuzzy / Split |
| ---: | ---: | ---: | ---: |
| ~97.7% | ~91.3% | ~2.3% | 22 / 18 / 2–3 |

With `--apply-corrections` (falls back to `data/demo_corrections.json`): human matches appear in the source breakdown and recall rises into the mid-90s. With an LLM provider, ambiguous near-dups resolve via the LLM tier.

```bash
npm install
npm run reconcile -- --seed 42 --skip-llm
npm run dashboard   # http://localhost:5173
```

Docker:

```bash
docker build -t razopay .
docker run --rm razopay
```

---

## Pipeline

1. **Payments** — gateway captures  
2. **Settlements** — fee/tax identity + UTR  
3. **Bank credits** — UTR join on net ≈ credited  
4. Passes: integrity → exact → fuzzy → split → LLM → human corrections  

Adversarial classes include near-duplicate decoys, boundary reference mangles, decoy subset-sums, and unresolvable noise — scored by `ambiguityLevel` (`clear` / `boundary` / `decoy` / `unresolvable`).

## Quick start

```bash
npm install
npm run reconcile -- --seed 42 --skip-llm
```

### Options

| Flag | Meaning |
| --- | --- |
| `--seed <n>` | Reproducible batch (default `42`) |
| `--generate-only` | Write data files and exit |
| `--skip-llm` | Force no LLM |
| `--llm-provider <…>` | `anthropic` \| `ollama` \| `none` |
| `--llm-model <name>` | Ollama model (default `llama3.2`) |
| `--apply-corrections` | Apply `output/corrections.json` or `data/demo_corrections.json` |
| `--runs <n>` | Multi-seed robustness (seeds `seed..seed+n-1`) |
| `--compare-llm` | Side-by-side LLM on vs off ablation |

### Optional LLM pass

Selection: `--llm-provider` → `ANTHROPIC_API_KEY` → Ollama → none.

```bash
npm run reconcile -- --seed 42 --compare-llm
npm run reconcile -- --seed 42 --runs 5 --skip-llm
npm run reconcile -- --seed 42 --skip-llm --apply-corrections
```

## Metrics (never blended)

Overall precision, recall, and FP rate are reported separately, plus **Accuracy by case difficulty** (clear / boundary / decoy / unresolvable).

## Tests & CI

```bash
npm test
npm run reconcile -- --seed 42 --skip-llm
npm run check-baseline
```

## Known limitations

- Split matching is bounded (pool ≤25, combo ≤6)
- Ambiguous multi-solution batches are not auto-picked
- No FX conversion
- Near-dup / boundary cases need LLM or human for full recall

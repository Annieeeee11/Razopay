# Razopay — Payment Gateway Settlement Reconciliation

![CI](https://github.com/Annieeeee11/Razopay/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

Razorpay-shaped **3-way settlement reconciliation**: Payments → Settlements (gross/fee/tax/net + UTR) → Bank payout credits. Deterministic exact → fuzzy → split resolve most of the batch; adversarial near-duplicates and boundary UTR mangles feed the LLM/human residual.

## 60-second demo

1. `npm install && npm run reconcile -- --seed 42 --skip-llm` — generates the batch, runs exact → fuzzy → split, prints the report.
2. `npm run dashboard` — open http://localhost:5173, see match rate/precision/recall/FP-rate split by case difficulty, plus the full exception list with reasons.
3. In the dashboard, click **Accept** on one ambiguous exception, then **Re-run with corrections** — watch the human-resolved count go from 0 to 1+ in the match-source chart.
4. `npm run reconcile -- --seed 42 --compare-llm --llm-provider ollama --llm-model llama3.2` — see the LLM pass's actual impact on recall, side by side with LLM disabled (requires local Ollama).

---

**Seed 42 headline metrics** (`npm run reconcile -- --seed 42 --skip-llm`):

| Precision | Recall | FP rate | Exact / Fuzzy / Split / LLM / Human |
| ---: | ---: | ---: | ---: |
| 97.67% | 91.30% | 2.33% | 22 / 18 / 3 / 0 / 0 |

**LLM ablation** (`npm run reconcile -- --seed 42 --compare-llm --llm-provider ollama --llm-model llama3.2`, actual run):

| | With LLM | Without LLM |
| --- | ---: | ---: |
| Match rate / Recall | 95.65% | 91.30% |
| Precision | 97.78% | 97.67% |
| FP rate | 2.22% | 2.33% |
| LLM matches | 2 | 0 |
| Provider | ollama | none |

With Ollama (`llama3.2`) resolving the ambiguous residual, recall rises from **91.30%** to **95.65%**, correctly resolving **2 of the 4** near-duplicate/boundary pairs in that ablation run (`bank_0039`/`setl_0039`, `bank_0042`/`setl_0044` — reasoning cited amount + UTR). The other two residual true matches were rejected as `no_match` (exact UTR string inequality on truncated references) — disclosed under Known Limitations. A follow-up non-ablation run with the same provider regenerated `output/report.json` / the dashboard primary view (LLM tier visible in the match-source chart; recall may differ slightly because local LLM output is nondeterministic). Without a provider, both columns fall back to `none` and recall stays at the skip-llm baseline.

**Human loop:** Accept in the dashboard writes `output/corrections.json`. **Re-run with corrections** (or `npm run reconcile -- --seed 42 --skip-llm --apply-corrections`) lifts recall to **95.65%** with **Human: 2** in the match-source chart (actual run using `data/demo_corrections.json` when no prior corrections file exists).

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

Adversarial classes include near-duplicate decoys, boundary reference mangles, decoy subset-sums, and unresolvable noise — scored by `ambiguityLevel` (`clear` / `boundary` / `decoy` / `unresolvable`). The dashboard shows this breakdown under the summary metrics.

## Human correction click-through

1. Run reconcile, then `npm run dashboard`.
2. On an ambiguous / exception row, click **Accept** (or **Reject**) — the row greys out as “resolved — pending re-run” and the decision is appended to `output/corrections.json` via the Vite `/api/corrections` route.
3. Click **Re-run with corrections** — the dashboard triggers `npm run reconcile -- --seed 42 --skip-llm --apply-corrections`, reloads `report.json`, and the match-source **human** bar becomes nonzero. That is the closed finance-ops loop.

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
npm run reconcile -- --seed 42 --compare-llm --llm-provider ollama --llm-model llama3.2
npm run reconcile -- --seed 42 --llm-provider ollama --llm-model llama3.2
npm run reconcile -- --seed 42 --runs 5 --skip-llm
npm run reconcile -- --seed 42 --skip-llm --apply-corrections
```

## Metrics (never blended)

Overall precision, recall, and FP rate are reported separately, plus **Accuracy by case difficulty** (clear / boundary / decoy / unresolvable) in both `output/report.md` and the dashboard.

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
- On the Ollama `llama3.2` ablation run (seed 42), the model correctly matched 2 of 4 residual true pairs (`bank_0039`/`setl_0039`, `bank_0042`/`setl_0044`) citing amount + UTR signals, but incorrectly rejected the other two true near-dup pairs (`bank_0040`/`setl_0040`, `bank_0041`/`setl_0042`) as `no_match` because truncated UTRs were not treated as prefixes — leaving those as false negatives
- Local LLM output is nondeterministic: a follow-up run with the same seed/model resolved a different 3 of 4 residual pairs (recall 97.83% in `output/report.json` used by the dashboard) while rejecting `bank_0042`/`setl_0044` on the same truncated-UTR rationale — not cherry-picked across re-runs

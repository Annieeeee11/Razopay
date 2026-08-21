<div align="center">
  <img width="476" height="147" alt="image" src="https://github.com/user-attachments/assets/cb6a7870-c367-45c9-a050-988015c58bfc" />
</div>

# SettleSure: Payment Gateway Settlement Reconciliation

![Razorpay](https://img.shields.io/badge/Razorpay-072654?style=flat&logo=razorpay&logoColor=white)
![CI](https://github.com/Annieeeee11/SettleSure/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![LLM agent](https://img.shields.io/badge/llm--agent-111827?style=flat&logo=openai&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?style=flat&logo=ollama&logoColor=white)

This is a Razorpay-style 3-way settlement reconciliation: Payments → Settlements (gross/fee/tax/net + UTR) → Bank payout credits. Exact, fuzzy, and split matching handle most of the batch. The harder leftover cases (near-duplicates and UTRs mangled right at the fuzzy boundary) go to the LLM or a human.

## 60-second demo

1. `npm install && npm run reconcile -- --seed 42 --skip-llm` generates the batch, runs exact → fuzzy → split, and prints the report.
2. `npm run dashboard` opens http://localhost:5173. You’ll see match rate, precision, recall, and FP rate by case difficulty, plus the full exception list with reasons.
3. In the dashboard, click **Accept** on one ambiguous exception, then **Re-run with corrections**. The human-resolved count should move from 0 to 1+ in the match-source chart.
4. `npm run reconcile -- --seed 42 --compare-llm --llm-provider ollama --llm-model llama3.2` shows what the LLM pass actually does to recall, side by side with LLM off (needs local Ollama).

<img width="575" height="578" alt="image" src="https://github.com/user-attachments/assets/0aa1b20d-48ce-4e48-ab98-ea39dfa0c4d2" />


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

With Ollama (`llama3.2`) on the leftover ambiguous pairs, recall went from **91.30%** to **95.65%**. In that ablation run it correctly resolved **2 of the 4** near-duplicate/boundary pairs (`bank_0039`/`setl_0039`, `bank_0042`/`setl_0044`; the model cited amount + UTR). The other two true matches were called `no_match` because it treated truncated UTRs as unequal strings. That’s called out under Known Limitations. A later run without `--compare-llm`, same provider, rewrote `output/report.json` and the dashboard main view so the LLM tier shows up in the match-source chart. Recall can shift a bit between runs since local LLM output isn’t deterministic. If there’s no provider, both columns fall back to `none` and recall stays at the skip-llm baseline.

**Human loop:** Accept in the dashboard writes `output/corrections.json`. **Re-run with corrections** (or `npm run reconcile -- --seed 42 --skip-llm --apply-corrections`) brings recall to **95.65%** with **Human: 2** in the match-source chart. That run used `data/demo_corrections.json` when no corrections file existed yet.

```bash
npm install
npm run reconcile -- --seed 42 --skip-llm
npm run dashboard   # http://localhost:5173
```

Docker:

```bash
docker build -t settlesure .
docker run --rm settlesure
```

---

## Pipeline

1. **Payments**: gateway captures  
2. **Settlements**: fee/tax identity + UTR  
3. **Bank credits**: UTR join on net ≈ credited  
4. Passes: integrity → exact → fuzzy → split → LLM → human corrections  

Adversarial cases include near duplicate decoys, boundary reference mangles, decoy subset sums, and unresolvable noise. They’re scored with `ambiguityLevel` (`clear` / `boundary` / `decoy` / `unresolvable`). The dashboard shows that breakdown under the summary metrics.

## Human correction click-through

1. Run reconcile, then `npm run dashboard`.
2. On an ambiguous / exception row, click **Accept** (or **Reject**). The row greys out as “resolved — pending re-run” and the decision is appended to `output/corrections.json` via the Vite `/api/corrections` route.
3. Click **Re-run with corrections**. The dashboard runs `npm run reconcile -- --seed 42 --skip-llm --apply-corrections`, reloads `report.json`, and the match-source **human** bar becomes nonzero. That’s the closed finance-ops loop.

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

Provider selection order: `--llm-provider` → `ANTHROPIC_API_KEY` → Ollama → none.

```bash
npm run reconcile -- --seed 42 --compare-llm --llm-provider ollama --llm-model llama3.2
npm run reconcile -- --seed 42 --llm-provider ollama --llm-model llama3.2
npm run reconcile -- --seed 42 --runs 5 --skip-llm
npm run reconcile -- --seed 42 --skip-llm --apply-corrections
```

## Metrics (never blended)

Overall precision, recall, and FP rate are reported separately. You also get **Accuracy by case difficulty** (clear / boundary / decoy / unresolvable) in both `output/report.md` and the dashboard.

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
- Near dup / boundary cases need LLM or human for full recall
- On the Ollama `llama3.2` ablation run (seed 42), the model correctly matched 2 of 4 residual true pairs (`bank_0039`/`setl_0039`, `bank_0042`/`setl_0044`) using amount + UTR signals, but wrongly rejected the other two true near dup pairs (`bank_0040`/`setl_0040`, `bank_0041`/`setl_0042`) as `no_match` because truncated UTRs weren’t treated as prefixes. Those stayed false negatives.
- Local LLM output isn’t deterministic. A follow-up run with the same seed and model resolved a different 3 of 4 residual pairs (recall 97.83% in `output/report.json`, which the dashboard uses) and rejected `bank_0042`/`setl_0044` for the same truncated-UTR reason. We didn’t re-run until the numbers looked nicer.

## What broke, and what we did about it

**The first version scored a perfect 100%.** Seed 42 came back with 100% match rate, precision, and recall, 0% false positives, and the LLM and human tiers never fired. On a track that cares about measured accuracy over a cherry-picked win, that looked like easy data, not a flawless engine. We rebuilt the generator with near duplicate decoys, boundary UTR mangles at the fuzzy threshold, and split batches with a coincidental decoy sum. The skip-llm baseline is now **97.67% precision / 91.30% recall / 2.33% FP**. Lower, but more honest, and the leftover tiers actually have something to do.

**The first LLM ablation was a no-op.** `--compare-llm` printed the same numbers on both sides because both silently fell back to provider `none`. We ran it again against local Ollama (`llama3.2`): recall went from **91.30% → 95.65%**, correctly resolving **2 of 4** ambiguous pairs. The two false `no_match` calls are under Known Limitations instead of being swept under the rug.

Spotting a perfect score and a flat ablation as non results was the same kind of call as the metrics themselves: if the output looks too clean, treat it as a failure mode until the residual tiers have real work left.

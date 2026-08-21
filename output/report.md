# Payment Gateway Settlement Reconciliation Report

Razorpay-style 3-way flow: **Payment → Settlement → Bank payout credit** (UTR join).

Seed: `42` · Payments: 69 · Settlements: 69 · Bank credits: 57
LLM pass: disabled / unavailable

## Headline metrics

| Metric | Value |
| --- | --- |
| Match rate (recall on true matches) | 91.30% |
| Precision | 97.67% |
| Recall | 91.30% |
| False positive rate | 2.33% |
| Exception accuracy | 75.00% |
| Throughput | 9453.07 records/sec |
| Runtime (total) | 13.33 ms |

### Counts

- True matches in ground truth: 46
- Predicted matches: 43
- True positives: 42
- False positives: 1
- False negatives: 4
- True exception records: 30
- Predicted exception records: 32
- Correctly flagged exceptions: 24

## Match-source breakdown

| Pass | Count |
| --- | ---: |
| Exact | 22 |
| Fuzzy | 18 |
| Split | 3 |
| LLM | 0 |
| Human | 0 |

| Pass timing | ms |
| --- | ---: |
| Exact | 0.38 |
| Fuzzy | 10.83 |
| Split | 0.66 |
| LLM | 0.26 |
| Total | 13.33 |

## Accuracy by case difficulty

| Difficulty | Match rate | Precision | Deferred | Notes |
| --- | --- | --- | --- | --- |
| Clear | 100.00% | 97.44% | — | trivial exact/fuzzy cases |
| Boundary | 80.00% | 100.00% | — | at fuzzy threshold edge |
| Decoy | 0.00% | 0.00% | 68.75% | correctly deferred, not auto-resolved to decoy |
| Unresolvable | — | — | 100.00% | correctly flagged as exception |

## Exception list

| Record ID | Source | Reason |
| --- | --- | --- |
| setl_0060 | settlement | fee/tax miscalculation: netAmount 955.72 ≠ gross(928.21) - fee(19.77) - tax(3.56) = 904.88 |
| setl_0061 | settlement | fee/tax miscalculation: netAmount 143.66 ≠ gross(100.71) - fee(1.57) - tax(0.28) = 98.86 |
| setl_0062 | settlement | fee/tax miscalculation: netAmount 146.14 ≠ gross(108.06) - fee(1.67) - tax(0.3) = 106.09 |
| bank_0049 | bank | currency mismatch, not auto-resolved |
| bank_0050 | bank | currency mismatch, not auto-resolved |
| setl_0066 | settlement | currency mismatch, not auto-resolved |
| setl_0067 | settlement | currency mismatch, not auto-resolved |
| bank_0045 | bank | ambiguous split — multiple settlement combinations sum to credit: setl_0052+setl_0053 \| setl_0054+setl_0055 |
| bank_0046 | bank | ambiguous split — multiple settlement combinations sum to credit: setl_0056+setl_0057 \| setl_0058+setl_0059 |
| bank_0039 | bank | ambiguous — LLM unavailable |
| setl_0039 | settlement | ambiguous — LLM unavailable |
| bank_0040 | bank | ambiguous — LLM unavailable |
| setl_0040 | settlement | ambiguous — LLM unavailable |
| bank_0041 | bank | ambiguous — LLM unavailable |
| setl_0042 | settlement | ambiguous — LLM unavailable |
| bank_0042 | bank | ambiguous — LLM unavailable |
| setl_0044 | settlement | ambiguous — LLM unavailable |
| bank_0047 | bank | no plausible counterpart in window |
| bank_0048 | bank | no plausible counterpart in window |
| bank_0051 | bank | no plausible counterpart in window |
| bank_0052 | bank | no plausible counterpart in window |
| bank_0053 | bank | no plausible counterpart in window |
| bank_0055 | bank | UTR present in bank feed but no matching settlement (unclaimed credit) |
| setl_0043 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0045 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0056 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0057 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0058 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0059 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0063 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0064 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0065 | settlement | settlement present, bank credit missing (payout may be in transit) |

## Known limitations

- Split matching uses bounded subset-sum (max pool 25, max combo 6) — demo-scale only.
- Ambiguous multi-solution batches are not auto-resolved.
- No FX conversion — currency mismatches are never auto-resolved.
- Fuzzy matching uses net/credited amount, settlement/credit dates, and UTR similarity only.
- Duplicate bank credits: first claim wins; extras become exceptions.
- Near-duplicate decoys and boundary UTR mangles are intentional hard cases for LLM/human tiers.

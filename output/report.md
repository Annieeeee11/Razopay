# Payment Gateway Settlement Reconciliation Report

Razorpay-style 3-way flow: **Payment → Settlement → Bank payout credit** (UTR join).

Seed: `42` · Payments: 57 · Settlements: 57 · Bank credits: 52
LLM pass: disabled / unavailable

## Headline metrics

| Metric | Value |
| --- | --- |
| Match rate (recall on true matches) | 100.00% |
| Precision | 100.00% |
| Recall | 100.00% |
| False positive rate | 0.00% |
| Exception accuracy | 100.00% |
| Throughput | 10151.81 records/sec |
| Runtime (total) | 10.74 ms |

### Counts

- True matches in ground truth: 44
- Predicted matches: 44
- True positives: 44
- False positives: 0
- False negatives: 0
- True exception records: 17
- Predicted exception records: 17
- Correctly flagged exceptions: 17

## Match-source breakdown

| Pass | Count |
| --- | ---: |
| Exact | 24 |
| Fuzzy | 17 |
| Split | 3 |
| LLM | 0 |
| Human | 0 |

| Pass timing | ms |
| --- | ---: |
| Exact | 0.34 |
| Fuzzy | 8.97 |
| Split | 0.54 |
| LLM | 0.11 |
| Total | 10.74 |

## Exception list

| Record ID | Source | Reason |
| --- | --- | --- |
| setl_0044 | settlement | fee/tax miscalculation: netAmount 360.12 ≠ gross(344.26) - fee(7.78) - tax(1.4) = 335.08 |
| setl_0045 | settlement | fee/tax miscalculation: netAmount 2343.23 ≠ gross(2333.48) - fee(38.18) - tax(6.87) = 2288.43 |
| setl_0046 | settlement | fee/tax miscalculation: netAmount 2373.36 ≠ gross(2410.77) - fee(56.15) - tax(10.11) = 2344.51 |
| bank_0044 | bank | currency mismatch, not auto-resolved |
| bank_0045 | bank | currency mismatch, not auto-resolved |
| setl_0042 | settlement | currency mismatch, not auto-resolved |
| setl_0043 | settlement | currency mismatch, not auto-resolved |
| bank_0041 | bank | UTR present in bank feed but no matching settlement (unclaimed credit) |
| bank_0043 | bank | UTR present in bank feed but no matching settlement (unclaimed credit) |
| bank_0046 | bank | UTR present in bank feed but no matching settlement (unclaimed credit) |
| bank_0047 | bank | UTR present in bank feed but no matching settlement (unclaimed credit) |
| bank_0048 | bank | UTR present in bank feed but no matching settlement (unclaimed credit) |
| bank_0049 | bank | UTR present in bank feed but no matching settlement (unclaimed credit) |
| setl_0047 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0048 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0049 | settlement | settlement present, bank credit missing (payout may be in transit) |
| setl_0050 | settlement | settlement present, bank credit missing (payout may be in transit) |

## Known limitations

- Split matching uses bounded subset-sum (max pool 25, max combo 6) — demo-scale only.
- Ambiguous multi-solution batches are not auto-resolved.
- No FX conversion — currency mismatches are never auto-resolved.
- Fuzzy matching uses net/credited amount, settlement/credit dates, and UTR similarity only.
- Duplicate bank credits: first claim wins; extras become exceptions.

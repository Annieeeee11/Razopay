import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  levenshtein,
  normalizeReference,
  referenceSimilarity,
} from "../engine/fuzzyMatch.js";
import type {
  AmbiguityLevel,
  BankCreditRecord,
  Correction,
  DiscrepancyClass,
  GroundTruthLabel,
  PaymentRecord,
  SettlementRecord,
} from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = join(ROOT, "data");

export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function makeUtr(rng: () => number, index: number): string {
  const suffix = Array.from({ length: 6 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rng() * 32)],
  ).join("");
  return `UTR${pad(index + 1, 6)}${suffix}`;
}

function feeTax(
  gross: number,
  rng: () => number,
): { fee: number; tax: number; net: number } {
  const fee = roundMoney(gross * (0.015 + rng() * 0.01));
  const tax = roundMoney(fee * 0.18);
  const net = roundMoney(gross - fee - tax);
  return { fee, tax, net };
}

/** Edit `utr` until normalized Levenshtein similarity ≈ targetSim (±0.02). */
export function mangleUtrToSimilarity(
  utr: string,
  targetSim: number,
  rng: () => number,
): string {
  const base = normalizeReference(utr);
  let best = utr;
  let bestDiff = 1;

  // Try truncations
  for (let drop = 1; drop <= Math.min(8, base.length - 4); drop++) {
    const cand = utr.slice(0, Math.max(4, utr.length - drop));
    const sim = referenceSimilarity(utr, cand);
    const diff = Math.abs(sim - targetSim);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cand;
    }
  }

  // Try single-char deletes / substitutions
  for (let i = 3; i < utr.length - 1; i++) {
    const del = utr.slice(0, i) + utr.slice(i + 1);
    const sim = referenceSimilarity(utr, del);
    const diff = Math.abs(sim - targetSim);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = del;
    }
    const sub =
      utr.slice(0, i) +
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rng() * 32)] +
      utr.slice(i + 1);
    const sim2 = referenceSimilarity(utr, sub);
    const diff2 = Math.abs(sim2 - targetSim);
    if (diff2 < bestDiff) {
      bestDiff = diff2;
      best = sub;
    }
  }

  // Hyphen insert (light mangle → high sim)
  const hyphen = `${utr.slice(0, 6)}-${utr.slice(6)}`;
  const simH = referenceSimilarity(utr, hyphen);
  if (Math.abs(simH - targetSim) < bestDiff) best = hyphen;

  // If still far, force truncation to approximate target
  const maxLen = Math.max(base.length, 1);
  const targetDist = Math.round((1 - targetSim) * maxLen);
  if (bestDiff > 0.04 && targetDist > 0) {
    best = utr.slice(0, Math.max(4, utr.length - targetDist));
  }

  void levenshtein;
  return best;
}

function lightMangle(utr: string): string {
  return `${utr.slice(0, 6)}-${utr.slice(6)}`;
}

export interface GeneratedDataset {
  payments: PaymentRecord[];
  settlements: SettlementRecord[];
  bankCredits: BankCreditRecord[];
  groundTruth: GroundTruthLabel[];
  demoCorrections: Correction[];
  seed: number;
}

export function generateDataset(seed = 42): GeneratedDataset {
  const rng = createRng(seed);
  const payments: PaymentRecord[] = [];
  const settlements: SettlementRecord[] = [];
  const bankCredits: BankCreditRecord[] = [];
  const groundTruth: GroundTruthLabel[] = [];
  const demoCorrections: Correction[] = [];

  let paySeq = 0;
  let setSeq = 0;
  let bankSeq = 0;
  let eventIndex = 0;

  const nextPaymentId = () => `pay_${pad(++paySeq, 4)}`;
  const nextOrderId = () => `order_${pad(paySeq, 4)}`;
  const nextSettlementId = () => `setl_${pad(++setSeq, 4)}`;
  const nextBankId = () => `bank_${pad(++bankSeq, 4)}`;

  const classPlan: Array<{
    cls: DiscrepancyClass;
    count: number;
    level: AmbiguityLevel;
  }> = [
    { cls: "clean", count: 20, level: "clear" },
    { cls: "date_shifted", count: 6, level: "clear" },
    { cls: "amount_shifted", count: 5, level: "clear" },
    { cls: "reference_mangled", count: 3, level: "clear" },
    { cls: "reference_mangled_boundary", count: 5, level: "boundary" },
    { cls: "near_duplicate_decoy", count: 3, level: "decoy" },
    { cls: "batched_payout", count: 2, level: "clear" },
    { cls: "batched_payout_ambiguous", count: 2, level: "decoy" },
    { cls: "fee_tax_mismatch", count: 3, level: "unresolvable" },
    { cls: "settlement_pending_bank", count: 3, level: "unresolvable" },
    { cls: "unclaimed_bank_credit", count: 2, level: "unresolvable" },
    { cls: "currency_mismatch", count: 2, level: "unresolvable" },
    { cls: "unresolvable_noise", count: 3, level: "unresolvable" },
    { cls: "duplicate_bank", count: 2, level: "clear" },
  ];

  function pushPayment(
    amount: number,
    currency: string,
    date: string,
  ): PaymentRecord {
    const paymentId = nextPaymentId();
    const p: PaymentRecord = {
      orderId: nextOrderId(),
      paymentId,
      amount,
      currency,
      status: "captured",
      createdAt: date,
    };
    payments.push(p);
    return p;
  }

  let boundaryAboveLeft = 4;
  let nearDupForDemo = 0;

  for (const { cls, count, level } of classPlan) {
    for (let i = 0; i < count; i++) {
      const date = formatDate(
        new Date(Date.UTC(2025, 0, 1 + randInt(rng, 0, 90))),
      );
      const gross = roundMoney(100 + rng() * 4900);
      const currency = "INR";
      const utr = makeUtr(rng, eventIndex++);
      const { fee, tax, net } = feeTax(gross, rng);

      switch (cls) {
        case "clean": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          const bankId = nextBankId();
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: date,
            utr,
            currency,
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId,
            paymentId: pay.paymentId,
            label: "match",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "date_shifted": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          const bankId = nextBankId();
          const shift = randInt(rng, 1, 3) * (rng() < 0.5 ? -1 : 1);
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: addDays(date, shift),
            utr,
            currency,
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId,
            paymentId: pay.paymentId,
            label: "match",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "amount_shifted": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          const bankId = nextBankId();
          const deltaSign = rng() < 0.5 ? -1 : 1;
          const delta = roundMoney(
            Math.min(net * 0.015, Math.max(0.25, net * 0.005 + rng() * 0.4)) *
              deltaSign,
          );
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: date,
            utr,
            currency,
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: roundMoney(net + delta),
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId,
            paymentId: pay.paymentId,
            label: "match",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "reference_mangled": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          const bankId = nextBankId();
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: date,
            utr: lightMangle(utr),
            currency,
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId,
            paymentId: pay.paymentId,
            label: "match",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "reference_mangled_boundary": {
          // 3 above 0.75 (same day + high ref sim), 2 below (3d shift + ~0.65 ref)
          const above = boundaryAboveLeft > 0;
          if (above) boundaryAboveLeft--;
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          const bankId = nextBankId();
          // above: same day + ref~0.78 → score ≈ 0.4+0.3+0.234 ≈ 0.93
          // below: +3d + ref~0.65 → score ≈ 0.4+0.075+0.195 ≈ 0.67 (ambiguous)
          const targetSim = above ? 0.78 : 0.65;
          const mangled = mangleUtrToSimilarity(utr, targetSim, rng);
          const settledAt = above ? date : addDays(date, 3);
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt,
            utr: mangled,
            currency,
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId,
            paymentId: pay.paymentId,
            label: "match",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "near_duplicate_decoy": {
          const payTrue = pushPayment(gross, currency, date);
          const trueId = nextSettlementId();
          const decoyId = nextSettlementId();
          const bankId = nextBankId();
          // +3d and ref~0.68 → composite ~0.68 (ambiguous band for LLM)
          const trueUtr = mangleUtrToSimilarity(utr, 0.68, rng);
          const decoyUtr = mangleUtrToSimilarity(utr, 0.66, rng);
          const decoyNet = roundMoney(net * (1 + (rng() < 0.5 ? -0.012 : 0.012)));
          const decoyFee = roundMoney(decoyNet * 0.02);
          const decoyTax = roundMoney(decoyFee * 0.18);
          const decoyGross = roundMoney(decoyNet + decoyFee + decoyTax);
          const payDecoy = pushPayment(decoyGross, currency, date);
          settlements.push({
            settlementId: trueId,
            paymentId: payTrue.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: addDays(date, 3),
            utr: trueUtr,
            currency,
          });
          settlements.push({
            settlementId: decoyId,
            paymentId: payDecoy.paymentId,
            grossAmount: decoyGross,
            fee: decoyFee,
            tax: decoyTax,
            netAmount: decoyNet,
            settledAt: addDays(date, 2),
            utr: decoyUtr,
            currency,
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId: trueId,
            decoySettlementId: decoyId,
            paymentId: payTrue.paymentId,
            label: "match",
            class: cls,
            ambiguityLevel: level,
          });
          groundTruth.push({
            bankCreditId: null,
            settlementId: decoyId,
            paymentId: payDecoy.paymentId,
            label: "exception",
            exceptionType: "near_duplicate_decoy",
            class: cls,
            ambiguityLevel: level,
          });
          if (nearDupForDemo < 2) {
            demoCorrections.push({
              recordId: bankId,
              source: "bank",
              decision: "accept",
              correctedMatchId: trueId,
              score: 0.7,
              ts: new Date().toISOString(),
            });
            nearDupForDemo++;
          }
          break;
        }
        case "duplicate_bank": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          const bankId = nextBankId();
          const dupBankId = nextBankId();
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: date,
            utr,
            currency,
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          bankCredits.push({
            id: dupBankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId,
            paymentId: pay.paymentId,
            label: "match",
            class: "clean",
            ambiguityLevel: "clear",
          });
          groundTruth.push({
            bankCreditId: dupBankId,
            settlementId: null,
            label: "exception",
            exceptionType: "duplicate_bank",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "currency_mismatch": {
          const pay = pushPayment(gross, "INR", date);
          const settlementId = nextSettlementId();
          const bankId = nextBankId();
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: date,
            utr,
            currency: "INR",
          });
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency: "USD",
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId: null,
            label: "exception",
            exceptionType: "currency_mismatch",
            class: cls,
            ambiguityLevel: level,
          });
          groundTruth.push({
            bankCreditId: null,
            settlementId,
            paymentId: pay.paymentId,
            label: "exception",
            exceptionType: "currency_mismatch",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "fee_tax_mismatch": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          const badNet = roundMoney(net + 15 + rng() * 40);
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: badNet,
            settledAt: date,
            utr,
            currency,
          });
          groundTruth.push({
            bankCreditId: null,
            settlementId,
            paymentId: pay.paymentId,
            label: "exception",
            exceptionType: "fee_tax_mismatch",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "settlement_pending_bank": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          settlements.push({
            settlementId,
            paymentId: pay.paymentId,
            grossAmount: gross,
            fee,
            tax,
            netAmount: net,
            settledAt: date,
            utr,
            currency,
          });
          groundTruth.push({
            bankCreditId: null,
            settlementId,
            paymentId: pay.paymentId,
            label: "exception",
            exceptionType: "settlement_pending_bank",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "unclaimed_bank_credit": {
          const bankId = nextBankId();
          bankCredits.push({
            id: bankId,
            utr,
            creditedAmount: net,
            creditedAt: date,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId: null,
            label: "exception",
            exceptionType: "unclaimed_bank_credit",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "batched_payout": {
          const n = 3;
          const settlementIds: string[] = [];
          let sumNet = 0;
          const batchDate = date;
          const batchUtr = utr;
          const parts = [
            roundMoney(100 + rng() * 20),
            roundMoney(250 + rng() * 30),
            roundMoney(400 + rng() * 40),
          ];
          for (let k = 0; k < n; k++) {
            const forcedNet = parts[k]!;
            const fee = roundMoney(forcedNet * 0.02);
            const tax = roundMoney(fee * 0.18);
            const g = roundMoney(forcedNet + fee + tax);
            const pay = pushPayment(g, currency, batchDate);
            const settlementId = nextSettlementId();
            settlementIds.push(settlementId);
            sumNet = roundMoney(sumNet + forcedNet);
            settlements.push({
              settlementId,
              paymentId: pay.paymentId,
              grossAmount: g,
              fee,
              tax,
              netAmount: forcedNet,
              settledAt: addDays(batchDate, k % 2),
              utr: `${batchUtr}_S${k + 1}`,
              currency,
            });
          }
          const bankId = nextBankId();
          bankCredits.push({
            id: bankId,
            utr: batchUtr,
            creditedAmount: sumNet,
            creditedAt: addDays(batchDate, 1),
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId: settlementIds[0]!,
            settlementIds,
            label: "match",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
        case "batched_payout_ambiguous": {
          // a+b = credit and c+d = credit (two solutions)
          const batchDate = date;
          const batchUtr = utr;
          const nets = [100, 200, 150, 150];
          const credit = 300;
          const ids: string[] = [];
          for (let k = 0; k < 4; k++) {
            const forcedNet = nets[k]!;
            const fee = roundMoney(forcedNet * 0.02);
            const tax = roundMoney(fee * 0.18);
            const g = roundMoney(forcedNet + fee + tax);
            const pay = pushPayment(g, currency, batchDate);
            const settlementId = nextSettlementId();
            ids.push(settlementId);
            settlements.push({
              settlementId,
              paymentId: pay.paymentId,
              grossAmount: g,
              fee,
              tax,
              netAmount: forcedNet,
              settledAt: addDays(batchDate, k % 2),
              utr: `${batchUtr}_S${k + 1}`,
              currency,
            });
          }
          const bankId = nextBankId();
          bankCredits.push({
            id: bankId,
            utr: batchUtr,
            creditedAmount: credit,
            creditedAt: addDays(batchDate, 1),
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId: null,
            settlementIds: ids,
            label: "exception",
            exceptionType: "batched_payout_ambiguous",
            class: cls,
            ambiguityLevel: level,
          });
          for (const sid of ids) {
            groundTruth.push({
              bankCreditId: null,
              settlementId: sid,
              label: "exception",
              exceptionType: "batched_payout_ambiguous",
              class: cls,
              ambiguityLevel: level,
            });
          }
          break;
        }
        case "unresolvable_noise": {
          const bankId = nextBankId();
          // Far outside any plausible window vs generated settlements
          const noiseDate = "2024-06-15";
          const noiseAmount = roundMoney(50000 + rng() * 20000);
          const noiseUtr = `NOISE${pad(eventIndex, 8)}XXXXXX`;
          bankCredits.push({
            id: bankId,
            utr: noiseUtr,
            creditedAmount: noiseAmount,
            creditedAt: noiseDate,
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId: null,
            label: "exception",
            exceptionType: "unresolvable_noise",
            class: cls,
            ambiguityLevel: level,
          });
          break;
        }
      }
    }
  }

  if (settlements.length < 50 || bankCredits.length < 50) {
    throw new Error(
      `Dataset too small: settlements=${settlements.length}, bankCredits=${bankCredits.length}`,
    );
  }

  return {
    payments,
    settlements,
    bankCredits,
    groundTruth,
    demoCorrections,
    seed,
  };
}

export function writeDataset(
  dataset: GeneratedDataset,
  dataDir: string = DATA_DIR,
): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "payments.json"),
    JSON.stringify(dataset.payments, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "settlements.json"),
    JSON.stringify(dataset.settlements, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "bank_credits.json"),
    JSON.stringify(dataset.bankCredits, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "ground_truth.json"),
    JSON.stringify(dataset.groundTruth, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "demo_corrections.json"),
    JSON.stringify(dataset.demoCorrections, null, 2) + "\n",
  );
}

export function generateAndWrite(
  seed = 42,
  dataDir: string = DATA_DIR,
): GeneratedDataset {
  const dataset = generateDataset(seed);
  writeDataset(dataset, dataDir);
  return dataset;
}

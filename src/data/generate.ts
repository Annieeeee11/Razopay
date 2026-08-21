import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BankCreditRecord,
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

function feeTax(gross: number, rng: () => number): { fee: number; tax: number; net: number } {
  const fee = roundMoney(gross * (0.015 + rng() * 0.01));
  const tax = roundMoney(fee * 0.18);
  const net = roundMoney(gross - fee - tax);
  return { fee, tax, net };
}

export interface GeneratedDataset {
  payments: PaymentRecord[];
  settlements: SettlementRecord[];
  bankCredits: BankCreditRecord[];
  groundTruth: GroundTruthLabel[];
  seed: number;
}

export function generateDataset(seed = 42): GeneratedDataset {
  const rng = createRng(seed);
  const payments: PaymentRecord[] = [];
  const settlements: SettlementRecord[] = [];
  const bankCredits: BankCreditRecord[] = [];
  const groundTruth: GroundTruthLabel[] = [];

  let paySeq = 0;
  let setSeq = 0;
  let bankSeq = 0;
  let eventIndex = 0;

  const nextPaymentId = () => `pay_${pad(++paySeq, 4)}`;
  const nextOrderId = () => `order_${pad(paySeq, 4)}`;
  const nextSettlementId = () => `setl_${pad(++setSeq, 4)}`;
  const nextBankId = () => `bank_${pad(++bankSeq, 4)}`;

  const classPlan: Array<{ cls: DiscrepancyClass; count: number }> = [
    { cls: "clean", count: 22 },
    { cls: "date_shifted", count: 7 },
    { cls: "amount_shifted", count: 5 },
    { cls: "reference_mangled", count: 5 },
    { cls: "duplicate_bank", count: 2 },
    { cls: "currency_mismatch", count: 2 },
    { cls: "fee_tax_mismatch", count: 3 },
    { cls: "settlement_pending_bank", count: 4 },
    { cls: "unclaimed_bank_credit", count: 4 },
    { cls: "batched_payout", count: 3 },
  ];

  function pushPayment(amount: number, currency: string, date: string): PaymentRecord {
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

  function mangleUtr(rng: () => number, utr: string): string {
    const mode = randInt(rng, 0, 2);
    if (mode === 0) return utr.slice(0, Math.max(8, utr.length - randInt(rng, 1, 2)));
    if (mode === 1) return `${utr.slice(0, 6)}-${utr.slice(6)}`;
    const i = randInt(rng, 4, utr.length - 2);
    return utr.slice(0, i) + utr.slice(i + 1);
  }

  for (const { cls, count } of classPlan) {
    for (let i = 0; i < count; i++) {
      const date = formatDate(new Date(Date.UTC(2025, 0, 1 + randInt(rng, 0, 90))));
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
            utr: mangleUtr(rng, utr),
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
          });
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
          });
          groundTruth.push({
            bankCreditId: dupBankId,
            settlementId: null,
            label: "exception",
            exceptionType: "duplicate_bank",
            class: cls,
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
          });
          groundTruth.push({
            bankCreditId: null,
            settlementId,
            paymentId: pay.paymentId,
            label: "exception",
            exceptionType: "currency_mismatch",
            class: cls,
          });
          break;
        }
        case "fee_tax_mismatch": {
          const pay = pushPayment(gross, currency, date);
          const settlementId = nextSettlementId();
          // Deliberately break netAmount identity
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
          // No bank credit — integrity failure is the exception
          groundTruth.push({
            bankCreditId: null,
            settlementId,
            paymentId: pay.paymentId,
            label: "exception",
            exceptionType: "fee_tax_mismatch",
            class: cls,
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
          });
          break;
        }
        case "batched_payout": {
          // 2–4 settlements sharing one bank credit (sum of nets)
          const n = randInt(rng, 2, 4);
          const settlementIds: string[] = [];
          let sumNet = 0;
          const batchDate = date;
          const batchUtr = utr;
          for (let k = 0; k < n; k++) {
            const g = roundMoney(80 + rng() * 900);
            const ft = feeTax(g, rng);
            const pay = pushPayment(g, currency, batchDate);
            const settlementId = nextSettlementId();
            settlementIds.push(settlementId);
            sumNet = roundMoney(sumNet + ft.net);
            settlements.push({
              settlementId,
              paymentId: pay.paymentId,
              grossAmount: g,
              fee: ft.fee,
              tax: ft.tax,
              netAmount: ft.net,
              settledAt: addDays(batchDate, randInt(rng, 0, 2)),
              // Settlements in a batch often lack per-line UTR; use placeholder unique UTRs
              // Bank credit carries the batch UTR — Phase 4 matches on amount sum
              utr: `${batchUtr}_S${k + 1}`,
              currency,
            });
          }
          const bankId = nextBankId();
          bankCredits.push({
            id: bankId,
            utr: batchUtr,
            creditedAmount: sumNet,
            creditedAt: addDays(batchDate, randInt(rng, 0, 3)),
            currency,
          });
          groundTruth.push({
            bankCreditId: bankId,
            settlementId: settlementIds[0]!,
            settlementIds,
            label: "match",
            class: cls,
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

  return { payments, settlements, bankCredits, groundTruth, seed };
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
}

export function generateAndWrite(
  seed = 42,
  dataDir: string = DATA_DIR,
): GeneratedDataset {
  const dataset = generateDataset(seed);
  writeDataset(dataset, dataDir);
  return dataset;
}

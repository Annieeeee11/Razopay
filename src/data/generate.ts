import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BankTxn,
  DiscrepancyClass,
  GroundTruthLabel,
  LedgerEntry,
} from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = join(ROOT, "data");

/** Mulberry32 seeded PRNG — reproducible across runs. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
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

const MERCHANTS = [
  "ACME SUPPLIES",
  "NORTHWIND LOGISTICS",
  "CONTOSO CLOUD",
  "FABRIKAM PAYROLL",
  "TAILSPIN TRAVEL",
  "ADVENTURE WORKS",
  "WIDGET CO",
  "BLUE YONDER",
] as const;

const CATEGORIES = [
  "ops_expense",
  "payroll",
  "saas",
  "travel",
  "inventory",
  "utilities",
] as const;

interface EconomicEvent {
  date: string;
  amount: number;
  currency: string;
  referenceCode: string;
  description: string;
  category: string;
  class: DiscrepancyClass;
}

export interface GeneratedDataset {
  bank: BankTxn[];
  ledger: LedgerEntry[];
  groundTruth: GroundTruthLabel[];
  seed: number;
}

function makeBaseEvent(
  rng: () => number,
  index: number,
  cls: DiscrepancyClass,
): EconomicEvent {
  const baseDate = new Date(Date.UTC(2025, 0, 1 + randInt(rng, 0, 90)));
  const amount = roundMoney(25 + rng() * 4975);
  const merchant = pick(rng, MERCHANTS);
  // High-entropy refs so sequential events do not fuzzy-collide
  const suffix = Array.from({ length: 4 }, () =>
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rng() * 32)],
  ).join("");
  const ref = `REF${pad(index + 1, 5)}${suffix}`;
  return {
    date: formatDate(baseDate),
    amount,
    currency: "USD",
    referenceCode: ref,
    description: `${merchant} ${ref}`,
    category: pick(rng, CATEGORIES),
    class: cls,
  };
}

function mangleReference(rng: () => number, ref: string): string {
  const mode = randInt(rng, 0, 2);
  if (mode === 0) {
    // Truncate last 1–2 chars
    return ref.slice(0, Math.max(4, ref.length - randInt(rng, 1, 2)));
  }
  if (mode === 1) {
    // Insert hyphen / space reformatting
    return `${ref.slice(0, 3)}-${ref.slice(3)}`;
  }
  // Drop a middle character
  const i = randInt(rng, 3, ref.length - 2);
  return ref.slice(0, i) + ref.slice(i + 1);
}

export function generateDataset(seed = 42): GeneratedDataset {
  const rng = createRng(seed);
  const bank: BankTxn[] = [];
  const ledger: LedgerEntry[] = [];
  const groundTruth: GroundTruthLabel[] = [];

  let bankSeq = 0;
  let ledgerSeq = 0;

  const nextBankId = () => `BANK-${pad(++bankSeq, 4)}`;
  const nextLedgerId = () => `LEDGER-${pad(++ledgerSeq, 4)}`;

  const classPlan: Array<{ cls: DiscrepancyClass; count: number }> = [
    { cls: "clean", count: 25 },
    { cls: "date_shifted", count: 8 },
    { cls: "amount_shifted", count: 6 },
    { cls: "reference_mangled", count: 6 },
    { cls: "duplicate_bank", count: 3 },
    { cls: "missing_in_ledger", count: 4 },
    { cls: "missing_in_bank", count: 4 },
    { cls: "currency_mismatch", count: 3 },
  ];

  let eventIndex = 0;

  for (const { cls, count } of classPlan) {
    for (let i = 0; i < count; i++) {
      const event = makeBaseEvent(rng, eventIndex++, cls);

      switch (cls) {
        case "clean": {
          const bankId = nextBankId();
          const ledgerId = nextLedgerId();
          bank.push({
            id: bankId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            description: event.description,
            referenceCode: event.referenceCode,
          });
          ledger.push({
            id: ledgerId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            memo: event.description,
            referenceCode: event.referenceCode,
            category: event.category,
          });
          groundTruth.push({
            bankId,
            ledgerId,
            label: "match",
            class: cls,
          });
          break;
        }
        case "date_shifted": {
          const bankId = nextBankId();
          const ledgerId = nextLedgerId();
          const shift = randInt(rng, 1, 3) * (rng() < 0.5 ? -1 : 1);
          bank.push({
            id: bankId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            description: event.description,
            referenceCode: event.referenceCode,
          });
          ledger.push({
            id: ledgerId,
            date: addDays(event.date, shift),
            amount: event.amount,
            currency: event.currency,
            memo: event.description,
            referenceCode: event.referenceCode,
            category: event.category,
          });
          groundTruth.push({
            bankId,
            ledgerId,
            label: "match",
            class: cls,
          });
          break;
        }
        case "amount_shifted": {
          const bankId = nextBankId();
          const ledgerId = nextLedgerId();
          // Small fee/FX delta within fuzzy tolerance (±2% or ±0.50)
          const deltaSign = rng() < 0.5 ? -1 : 1;
          const delta = roundMoney(
            Math.min(
              event.amount * 0.015,
              Math.max(0.25, event.amount * 0.005 + rng() * 0.4),
            ) * deltaSign,
          );
          bank.push({
            id: bankId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            description: event.description,
            referenceCode: event.referenceCode,
          });
          ledger.push({
            id: ledgerId,
            date: event.date,
            amount: roundMoney(event.amount + delta),
            currency: event.currency,
            memo: `${event.description} (fee adj)`,
            referenceCode: event.referenceCode,
            category: event.category,
          });
          groundTruth.push({
            bankId,
            ledgerId,
            label: "match",
            class: cls,
          });
          break;
        }
        case "reference_mangled": {
          const bankId = nextBankId();
          const ledgerId = nextLedgerId();
          bank.push({
            id: bankId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            description: event.description,
            referenceCode: event.referenceCode,
          });
          ledger.push({
            id: ledgerId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            memo: event.description,
            referenceCode: mangleReference(rng, event.referenceCode),
            category: event.category,
          });
          groundTruth.push({
            bankId,
            ledgerId,
            label: "match",
            class: cls,
          });
          break;
        }
        case "duplicate_bank": {
          // Primary pair is a clean match; duplicate bank row is a true exception
          const bankId = nextBankId();
          const ledgerId = nextLedgerId();
          const dupBankId = nextBankId();
          bank.push({
            id: bankId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            description: event.description,
            referenceCode: event.referenceCode,
          });
          bank.push({
            id: dupBankId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            description: `${event.description} (DUP)`,
            referenceCode: event.referenceCode,
          });
          ledger.push({
            id: ledgerId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            memo: event.description,
            referenceCode: event.referenceCode,
            category: event.category,
          });
          groundTruth.push({
            bankId,
            ledgerId,
            label: "match",
            class: "clean",
          });
          groundTruth.push({
            bankId: dupBankId,
            ledgerId: null,
            label: "exception",
            exceptionType: "duplicate_bank",
            class: cls,
          });
          break;
        }
        case "missing_in_ledger": {
          const bankId = nextBankId();
          bank.push({
            id: bankId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            description: event.description,
            referenceCode: event.referenceCode,
          });
          groundTruth.push({
            bankId,
            ledgerId: null,
            label: "exception",
            exceptionType: "missing_in_ledger",
            class: cls,
          });
          break;
        }
        case "missing_in_bank": {
          const ledgerId = nextLedgerId();
          ledger.push({
            id: ledgerId,
            date: event.date,
            amount: event.amount,
            currency: event.currency,
            memo: event.description,
            referenceCode: event.referenceCode,
            category: event.category,
          });
          groundTruth.push({
            bankId: null,
            ledgerId,
            label: "exception",
            exceptionType: "missing_in_bank",
            class: cls,
          });
          break;
        }
        case "currency_mismatch": {
          const bankId = nextBankId();
          const ledgerId = nextLedgerId();
          bank.push({
            id: bankId,
            date: event.date,
            amount: event.amount,
            currency: "USD",
            description: event.description,
            referenceCode: event.referenceCode,
          });
          ledger.push({
            id: ledgerId,
            date: event.date,
            amount: event.amount,
            currency: "EUR",
            memo: event.description,
            referenceCode: event.referenceCode,
            category: event.category,
          });
          // Same economic event but must NOT auto-match — true exception on both sides
          groundTruth.push({
            bankId,
            ledgerId: null,
            label: "exception",
            exceptionType: "currency_mismatch",
            class: cls,
          });
          groundTruth.push({
            bankId: null,
            ledgerId,
            label: "exception",
            exceptionType: "currency_mismatch",
            class: cls,
          });
          break;
        }
      }
    }
  }

  if (bank.length < 50 || ledger.length < 50) {
    throw new Error(
      `Generated dataset too small: bank=${bank.length}, ledger=${ledger.length}`,
    );
  }

  return { bank, ledger, groundTruth, seed };
}

export function writeDataset(
  dataset: GeneratedDataset,
  dataDir: string = DATA_DIR,
): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "bank_statement.json"),
    JSON.stringify(dataset.bank, null, 2) + "\n",
  );
  writeFileSync(
    join(dataDir, "internal_ledger.json"),
    JSON.stringify(dataset.ledger, null, 2) + "\n",
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

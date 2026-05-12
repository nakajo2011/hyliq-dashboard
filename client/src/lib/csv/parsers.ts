import Papa from "papaparse";
import { parseHyperliquidTime } from "./datetime";
import { sha256Hex } from "./hash";
import type {
  ParsedFunding,
  ParsedTrade,
  ParsedTransfer,
  ParseResult,
  TradeDir,
} from "./types";

const VALID_DIRS: ReadonlySet<TradeDir> = new Set<TradeDir>([
  "Open Long",
  "Close Long",
  "Open Short",
  "Close Short",
  "Long > Short",
  "Short > Long",
]);

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").trim());
  if (Number.isNaN(n)) throw new Error(`Not a number: ${String(v)}`);
  return n;
}

function readCsv(text: string): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse error (line ${first.row}): ${first.message}`);
  }
  return parsed.data;
}

/** Normalize account name to a stable hash key (case-insensitive, trimmed). */
function accountKey(accountName: string): string {
  return accountName.trim().toLowerCase();
}

export async function parseTradeCsv(
  text: string,
  accountName: string
): Promise<ParseResult<ParsedTrade>> {
  const rows = readCsv(text);
  const result: ParsedTrade[] = [];
  const errors: ParseResult<ParsedTrade>["errors"] = [];
  const key = accountKey(accountName);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const dir = (r.dir ?? "").trim() as TradeDir;
      if (!VALID_DIRS.has(dir)) {
        throw new Error(`Unknown dir: ${r.dir}`);
      }
      const time = parseHyperliquidTime(r.time);
      const px = toNum(r.px);
      const sz = toNum(r.sz);
      const ntl = toNum(r.ntl);
      const fee = toNum(r.fee);
      const closed_pnl = toNum(r.closedPnl);
      const hash = await sha256Hex([
        "trade",
        key,
        time,
        r.coin,
        dir,
        px,
        sz,
        closed_pnl,
      ]);
      result.push({
        time,
        coin: (r.coin ?? "").trim(),
        dir,
        px,
        sz,
        ntl,
        fee,
        closed_pnl,
        hash,
      });
    } catch (e) {
      errors.push({
        line: i + 2,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { kind: "trade", rows: result, errors };
}

export async function parseFundingCsv(
  text: string,
  accountName: string
): Promise<ParseResult<ParsedFunding>> {
  const rows = readCsv(text);
  const result: ParsedFunding[] = [];
  const errors: ParseResult<ParsedFunding>["errors"] = [];
  const key = accountKey(accountName);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const time = parseHyperliquidTime(r.time);
      const sideRaw = (r.side ?? "").trim();
      const side =
        sideRaw === "Long" || sideRaw === "Short" ? sideRaw : ("" as const);
      const sz = toNum(r.sz);
      const payment = toNum(r.payment);
      const rate = toNum(r.rate);
      const hash = await sha256Hex([
        "funding",
        key,
        time,
        r.coin,
        side,
        payment,
      ]);
      result.push({
        time,
        coin: (r.coin ?? "").trim(),
        sz,
        side,
        payment,
        rate,
        hash,
      });
    } catch (e) {
      errors.push({
        line: i + 2,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { kind: "funding", rows: result, errors };
}

const AMOUNT_CURRENCY_RE = /^\s*(-?\d+(?:\.\d+)?)\s*([A-Z]{2,10})?\s*$/;

function parseAmountWithCurrency(raw: string): { amount: number; currency: string } {
  const m = AMOUNT_CURRENCY_RE.exec(raw ?? "");
  if (!m) throw new Error(`Unrecognized amount: ${raw}`);
  return { amount: Number(m[1]), currency: (m[2] ?? "").trim() };
}

export async function parseTransferCsv(
  text: string,
  accountName: string
): Promise<ParseResult<ParsedTransfer>> {
  const rows = readCsv(text);
  const result: ParsedTransfer[] = [];
  const errors: ParseResult<ParsedTransfer>["errors"] = [];
  const key = accountKey(accountName);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const time = parseHyperliquidTime(r.time);
      const { amount: accountValueChange, currency } = parseAmountWithCurrency(
        r.accountValueChange ?? ""
      );
      const { amount: fee } = parseAmountWithCurrency(r.fee ?? "0");
      const hash = await sha256Hex([
        "transfer",
        key,
        time,
        r.action,
        accountValueChange,
        currency,
      ]);
      result.push({
        time,
        action: (r.action ?? "").trim(),
        source: (r.source ?? "").trim(),
        destination: (r.destination ?? "").trim(),
        account_value_change: accountValueChange,
        fee,
        currency,
        hash,
      });
    } catch (e) {
      errors.push({
        line: i + 2,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { kind: "transfer", rows: result, errors };
}

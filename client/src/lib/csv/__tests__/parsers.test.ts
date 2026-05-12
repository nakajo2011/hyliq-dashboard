import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseFundingCsv,
  parseTradeCsv,
  parseTransferCsv,
} from "../parsers";

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.resolve(here, "../../../../../sample_csv");

const tradeAddr1 = "0x6b94D8192eD3691a2b66c942fd1775022CbDb5b4";
const tradeAddr2 = "0xA929Bd1dC1dC0DfA244F99350B9b698c9b493770";

function load(filename: string): string {
  return readFileSync(path.join(sampleDir, filename), "utf8");
}

describe("parseTradeCsv (sample fixtures)", () => {
  it("parses all 12 rows of trade_history_0x6b94...csv with no errors", async () => {
    const text = load(`trade_history_${tradeAddr1}.csv`);
    const result = await parseTradeCsv(text, tradeAddr1);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(12);
    // Spot check first row
    expect(result.rows[0]).toMatchObject({
      coin: "ETH",
      dir: "Open Long",
      px: 2068.7,
      sz: 0.0241,
    });
    expect(result.rows[0].time).toBe("2026-04-02T12:14:01+09:00");
    expect(result.rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses all 26 rows of trade_history_0xA929...csv with no errors", async () => {
    const text = load(`trade_history_${tradeAddr2} (2).csv`);
    const result = await parseTradeCsv(text, tradeAddr2);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(26);
  });

  it("includes 'Long > Short' as a valid direction", async () => {
    const text = load(`trade_history_${tradeAddr2} (2).csv`);
    const result = await parseTradeCsv(text, tradeAddr2);
    const longToShort = result.rows.find((r) => r.dir === "Long > Short");
    expect(longToShort).toBeDefined();
  });

  it("produces unique hashes for each row", async () => {
    const text = load(`trade_history_${tradeAddr2} (2).csv`);
    const result = await parseTradeCsv(text, tradeAddr2);
    const hashes = result.rows.map((r) => r.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("produces same hash on re-parse (deterministic)", async () => {
    const text = load(`trade_history_${tradeAddr1}.csv`);
    const a = await parseTradeCsv(text, tradeAddr1);
    const b = await parseTradeCsv(text, tradeAddr1);
    expect(a.rows.map((r) => r.hash)).toEqual(b.rows.map((r) => r.hash));
  });
});

describe("parseFundingCsv (sample fixtures)", () => {
  it("parses all 242 rows of funding_history.csv with no errors", async () => {
    const text = load("funding_history.csv");
    const result = await parseFundingCsv(text, tradeAddr2);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(242);
    expect(result.rows[0]).toMatchObject({
      coin: "ETH",
      side: "Long",
    });
  });
});

describe("parseTransferCsv (sample fixtures)", () => {
  it("parses all 5 rows of deposits_and_withdrawals.csv with no errors", async () => {
    const text = load("deposits_and_withdrawals.csv");
    const result = await parseTransferCsv(text, tradeAddr2);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({
      action: "send",
      source: "trading",
      destination: "trading",
      currency: "USDC",
    });
    expect(result.rows[0].account_value_change).toBeCloseTo(49.998173, 6);
  });
});

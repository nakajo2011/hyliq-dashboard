import { describe, expect, it } from "vitest";
import { parseMizuhoCsv } from "../mizuho";

// Faithful subset of the actual Mizuho quote.csv layout. Row 1 is the
// "参考相場" header band, row 2 is Japanese names, row 3 is ISO codes,
// data rows start at row 4. We use UTF-8 source here (the real file is
// Shift_JIS but ASCII portions — what we parse — are byte-identical).
const SAMPLE = [
  ",参考相場,,,,",
  "月日,米ドル,英ポンド,ユーロ,カナダドル",
  ",USD,GBP,EUR,CAD",
  "2026/4/1,150.50,200.00,160.00,110.00",
  "2026/4/2,151.20,200.50,160.50,110.20",
  "2026/4/3,*****,201.00,161.00,110.30",
  "2026/4/4,152.00,201.50,161.50,110.40",
  "",
].join("\n");

describe("parseMizuhoCsv", () => {
  it("extracts the USD column and skips ***** entries", () => {
    const result = parseMizuhoCsv(SAMPLE);
    expect(result.rates).toEqual([
      { date: "2026-04-01", usd_jpy: 150.5 },
      { date: "2026-04-02", usd_jpy: 151.2 },
      { date: "2026-04-04", usd_jpy: 152.0 },
    ]);
    expect(result.range).toEqual({ start: "2026-04-01", end: "2026-04-04" });
    expect(result.errors).toEqual([]);
  });

  it("zero-pads month and day", () => {
    const csv =
      ",USD\n2026/4/2,150.50\n2026/12/31,160.00\n2026/3/15,155.00\n";
    const result = parseMizuhoCsv(csv);
    expect(result.rates.map((r) => r.date)).toEqual([
      "2026-04-02",
      "2026-12-31",
      "2026-03-15",
    ]);
  });

  it("returns an error when USD column is not present", () => {
    const csv = ",GBP,EUR\n2026/4/1,200,160\n";
    const result = parseMizuhoCsv(csv);
    expect(result.rates).toEqual([]);
    expect(result.errors[0]).toMatch(/USD 列/);
  });

  it("flags malformed numeric values but keeps parsing", () => {
    const csv = ",USD\n2026/4/1,150.50\n2026/4/2,abc\n2026/4/3,152.00\n";
    const result = parseMizuhoCsv(csv);
    expect(result.rates.map((r) => r.usd_jpy)).toEqual([150.5, 152.0]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/abc/);
  });

  it("handles trailing empty line", () => {
    const csv = ",USD\n2026/4/1,150.50\n\n";
    const result = parseMizuhoCsv(csv);
    expect(result.rates).toEqual([{ date: "2026-04-01", usd_jpy: 150.5 }]);
  });

  it("decodes Shift_JIS ArrayBuffer input", () => {
    // Manually craft a Shift_JIS encoded buffer: Japanese chars in headers
    // (米ドル = 0x95 0xC4 0x83 0x68 0x83 0x8B). We only need ASCII for our
    // parser to work, but verify the codepath that goes through TextDecoder.
    const bytes = new Uint8Array([
      // ",USD\n"
      0x2c, 0x55, 0x53, 0x44, 0x0a,
      // "2026/4/1,150.50\n"
      0x32, 0x30, 0x32, 0x36, 0x2f, 0x34, 0x2f, 0x31, 0x2c, 0x31, 0x35,
      0x30, 0x2e, 0x35, 0x30, 0x0a,
    ]);
    const result = parseMizuhoCsv(bytes.buffer);
    expect(result.rates).toEqual([{ date: "2026-04-01", usd_jpy: 150.5 }]);
  });
});

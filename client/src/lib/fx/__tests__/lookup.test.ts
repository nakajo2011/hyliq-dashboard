import { describe, expect, it } from "vitest";
import { buildFxLookup, parseBulkFxInput } from "../lookup";

describe("buildFxLookup", () => {
  const rates = [
    { date: "2026-04-01", usd_jpy: 150.0 },
    { date: "2026-04-05", usd_jpy: 151.0 },
    { date: "2026-04-10", usd_jpy: 152.0 },
  ];

  it("returns exact match without carry-forward flag", () => {
    const lookup = buildFxLookup(rates);
    expect(lookup("2026-04-05")).toEqual({
      rate: 151.0,
      fxDate: "2026-04-05",
      carriedForward: false,
    });
  });

  it("carries forward to most recent prior rate (weekend/holiday handling)", () => {
    const lookup = buildFxLookup(rates);
    expect(lookup("2026-04-07")).toEqual({
      rate: 151.0,
      fxDate: "2026-04-05",
      carriedForward: true,
    });
  });

  it("returns null when no prior rate exists", () => {
    const lookup = buildFxLookup(rates);
    expect(lookup("2026-03-30")).toBeNull();
  });

  it("returns the latest rate for dates after all known rates", () => {
    const lookup = buildFxLookup(rates);
    expect(lookup("2026-05-01")).toEqual({
      rate: 152.0,
      fxDate: "2026-04-10",
      carriedForward: true,
    });
  });

  it("handles unsorted input", () => {
    const lookup = buildFxLookup([rates[2], rates[0], rates[1]]);
    expect(lookup("2026-04-05")?.rate).toBe(151.0);
  });

  it("returns null on empty input", () => {
    expect(buildFxLookup([])("2026-04-05")).toBeNull();
  });
});

describe("parseBulkFxInput", () => {
  it("parses common formats", () => {
    const text = [
      "2026-04-02 150.50",
      "2026/04/03,150.30",
      "  2026-4-4	150.10  ",
      "",
      "garbage line",
      "2026-04-05 -1",
    ].join("\n");
    const { rates, errors } = parseBulkFxInput(text);
    expect(rates).toEqual([
      { date: "2026-04-02", usd_jpy: 150.5 },
      { date: "2026-04-03", usd_jpy: 150.3 },
      { date: "2026-04-04", usd_jpy: 150.1 },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toMatch(/形式/);
    expect(errors[1].message).toMatch(/レート/);
  });

  it("ignores empty input", () => {
    expect(parseBulkFxInput("").rates).toEqual([]);
  });
});

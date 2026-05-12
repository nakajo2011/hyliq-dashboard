import { describe, expect, it } from "vitest";
import { parseHyperliquidTime } from "../datetime";

describe("parseHyperliquidTime", () => {
  it("converts JST timestamp with no leading zeros to ISO 8601", () => {
    expect(parseHyperliquidTime("2026/4/2 12:14:01")).toBe(
      "2026-04-02T12:14:01+09:00"
    );
  });

  it("handles trailing whitespace", () => {
    expect(parseHyperliquidTime("  2026/4/2 12:14:01  ")).toBe(
      "2026-04-02T12:14:01+09:00"
    );
  });

  it("handles two-digit month and day", () => {
    expect(parseHyperliquidTime("2026/12/31 23:59:59")).toBe(
      "2026-12-31T23:59:59+09:00"
    );
  });

  it("throws on unrecognized format", () => {
    expect(() => parseHyperliquidTime("not a date")).toThrow();
  });
});

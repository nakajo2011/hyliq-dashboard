import { describe, expect, it } from "vitest";
import { detectCsvKind } from "../detect";

describe("detectCsvKind", () => {
  it("detects trade with auto-extracted address from filename", () => {
    const result = detectCsvKind(
      "trade_history_0x6b94D8192eD3691a2b66c942fd1775022CbDb5b4.csv"
    );
    expect(result.kind).toBe("trade");
    expect(result.detectedAddress).toBe(
      "0x6b94D8192eD3691a2b66c942fd1775022CbDb5b4"
    );
  });

  it("detects trade even when filename has a suffix like ' (2).csv'", () => {
    const result = detectCsvKind(
      "trade_history_0xA929Bd1dC1dC0DfA244F99350B9b698c9b493770 (2).csv"
    );
    expect(result.kind).toBe("trade");
    expect(result.detectedAddress).toBe(
      "0xA929Bd1dC1dC0DfA244F99350B9b698c9b493770"
    );
  });

  it("detects funding from filename", () => {
    const result = detectCsvKind("funding_history.csv");
    expect(result.kind).toBe("funding");
    expect(result.detectedAddress).toBeUndefined();
  });

  it("detects transfer from filename", () => {
    const result = detectCsvKind("deposits_and_withdrawals.csv");
    expect(result.kind).toBe("transfer");
  });

  it("falls back to header inspection when filename is ambiguous", () => {
    const result = detectCsvKind("export.csv", [
      "time",
      "coin",
      "dir",
      "px",
      "sz",
      "ntl",
      "fee",
      "closedPnl",
    ]);
    expect(result.kind).toBe("trade");
  });

  it("returns null when nothing matches", () => {
    expect(detectCsvKind("random.csv").kind).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { detectCsvKind } from "../detect";

describe("detectCsvKind", () => {
  it("detects trade history from filename (no address extraction)", () => {
    const result = detectCsvKind(
      "trade_history_0x6b94D8192eD3691a2b66c942fd1775022CbDb5b4.csv"
    );
    expect(result.kind).toBe("trade");
    // We no longer auto-extract an address — the user supplies the account
    // name explicitly via the upload UI.
    expect("detectedAddress" in result).toBe(false);
  });

  it("detects trade even with a download suffix like ' (2).csv'", () => {
    const result = detectCsvKind(
      "trade_history_0xA929Bd1dC1dC0DfA244F99350B9b698c9b493770 (2).csv"
    );
    expect(result.kind).toBe("trade");
  });

  it("detects funding from filename", () => {
    expect(detectCsvKind("funding_history.csv").kind).toBe("funding");
  });

  it("detects transfer from filename", () => {
    expect(detectCsvKind("deposits_and_withdrawals.csv").kind).toBe("transfer");
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

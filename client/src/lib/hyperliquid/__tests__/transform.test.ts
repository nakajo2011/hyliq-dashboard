import { describe, expect, it } from "vitest";
import { parseHyperliquidTime } from "../../csv/datetime";
import { sha256Hex } from "../../csv/hash";
import {
  msToCsvIsoJst,
  transformFills,
  transformFundings,
  transformLedgerUpdates,
} from "../transform";
import type { HlFill, HlFunding, HlLedgerUpdate } from "../api";

describe("msToCsvIsoJst", () => {
  it("matches the CSV time format (JST, second precision)", () => {
    // 2026-04-02 03:14:01 UTC = 2026-04-02 12:14:01 JST
    const ms = Date.UTC(2026, 3, 2, 3, 14, 1);
    expect(msToCsvIsoJst(ms)).toBe("2026-04-02T12:14:01+09:00");
  });

  it("produces the same string as parseHyperliquidTime for the same instant", () => {
    const ms = Date.UTC(2026, 3, 2, 3, 14, 1);
    // CSV would say "2026/4/2 12:14:01" for the same instant
    expect(msToCsvIsoJst(ms)).toBe(parseHyperliquidTime("2026/4/2 12:14:01"));
  });
});

describe("transformFills", () => {
  const baseFill: HlFill = {
    coin: "ETH",
    px: "2000.5",
    sz: "1.5",
    side: "B",
    time: Date.UTC(2026, 3, 2, 3, 14, 1),
    startPosition: "0",
    dir: "Open Long",
    closedPnl: "0.0",
    hash: "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
    oid: 1,
    crossed: true,
    fee: "0.5",
    tid: 2,
    feeToken: "USDC",
    twapId: null,
  };

  it("maps a Perp fill to a ParsedTrade with computed ntl", async () => {
    const out = await transformFills([baseFill], "Main");
    expect(out.skippedNonPerp).toBe(0);
    expect(out.rows).toHaveLength(1);
    const r = out.rows[0];
    expect(r.coin).toBe("ETH");
    expect(r.dir).toBe("Open Long");
    expect(r.px).toBe(2000.5);
    expect(r.sz).toBe(1.5);
    expect(r.ntl).toBeCloseTo(3000.75, 6);
    expect(r.fee).toBe(0.5);
    expect(r.closed_pnl).toBe(0);
    expect(r.time).toBe("2026-04-02T12:14:01+09:00");
  });

  it("skips fills whose dir is not one of the 6 Perp directions", async () => {
    const spot = { ...baseFill, dir: "Spot Buy" };
    const out = await transformFills([baseFill, spot], "Main");
    expect(out.skippedNonPerp).toBe(1);
    expect(out.rows).toHaveLength(1);
  });

  it("produces the same hash as the CSV path for the same logical fill", async () => {
    const out = await transformFills([baseFill], "Main");
    const expected = await sha256Hex([
      "trade",
      "main",
      "2026-04-02T12:14:01+09:00",
      "ETH",
      "Open Long",
      2000.5,
      1.5,
      0,
    ]);
    expect(out.rows[0].hash).toBe(expected);
  });
});

describe("transformFundings", () => {
  const ev: HlFunding = {
    time: Date.UTC(2026, 3, 2, 0, 0, 0),
    hash: "0x" + "0".repeat(64),
    delta: {
      type: "funding",
      coin: "BTC",
      usdc: "-3.625312",
      szi: "49.1477",
      fundingRate: "0.0000417",
      nSamples: null,
    },
  };

  it("infers Long side from positive szi and treats usdc as the payment", async () => {
    const rows = await transformFundings([ev], "Main");
    expect(rows).toHaveLength(1);
    expect(rows[0].side).toBe("Long");
    expect(rows[0].payment).toBeCloseTo(-3.625312, 6);
    expect(rows[0].rate).toBeCloseTo(0.0000417, 9);
    expect(rows[0].sz).toBeCloseTo(49.1477, 4);
    expect(rows[0].coin).toBe("BTC");
  });

  it("infers Short from negative szi", async () => {
    const short = { ...ev, delta: { ...ev.delta, szi: "-10" } };
    const rows = await transformFundings([short], "Main");
    expect(rows[0].side).toBe("Short");
    expect(rows[0].sz).toBe(10);
  });

  it("hash matches the CSV funding hash for the same canonical fields", async () => {
    const rows = await transformFundings([ev], "Main");
    const expected = await sha256Hex([
      "funding",
      "main",
      rows[0].time,
      "BTC",
      "Long",
      -3.625312,
    ]);
    expect(rows[0].hash).toBe(expected);
  });
});

describe("transformLedgerUpdates", () => {
  function mk(delta: HlLedgerUpdate["delta"]): HlLedgerUpdate {
    return {
      time: Date.UTC(2026, 3, 2, 0, 0, 0),
      hash: "0x" + "0".repeat(64),
      delta,
    };
  }

  it("maps deposit / withdraw / accountClassTransfer to canonical actions", async () => {
    const out = await transformLedgerUpdates(
      [
        mk({ type: "deposit", usdc: "100.0" }),
        mk({ type: "withdraw", usdc: "-50.0", nonce: 1, fee: "1.0" }),
        mk({ type: "accountClassTransfer", usdc: "10.0", toPerp: true }),
      ],
      "Main"
    );
    expect(out.skippedUnknown).toBe(0);
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0].action).toBe("deposit");
    expect(out.rows[0].account_value_change).toBe(100);
    expect(out.rows[0].destination).toBe("perp");
    expect(out.rows[1].action).toBe("withdraw");
    expect(out.rows[1].fee).toBe(1);
    expect(out.rows[2].action).toBe("accountClassTransfer");
    expect(out.rows[2].source).toBe("spot");
    expect(out.rows[2].destination).toBe("perp");
  });

  it("falls back to delta.type for unknown shapes with a usdc field", async () => {
    const out = await transformLedgerUpdates(
      [mk({ type: "vaultDeposit", usdc: "5.0" })],
      "Main"
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].action).toBe("vaultDeposit");
    expect(out.rows[0].account_value_change).toBe(5);
  });

  it("maps a 'send' spot transfer using amount+token (not usdc)", async () => {
    const out = await transformLedgerUpdates(
      [
        mk({
          type: "send",
          user: "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24",
          destination: "0x6b94d8192ed3691a2b66c942fd1775022cbdb5b4",
          sourceDex: "spot",
          destinationDex: "",
          token: "USDC",
          amount: "98.0",
          usdcValue: "98.0",
          fee: "0.0",
        } as unknown as HlLedgerUpdate["delta"]),
      ],
      "Main"
    );
    expect(out.skippedUnknown).toBe(0);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].action).toBe("send");
    expect(out.rows[0].account_value_change).toBe(98);
    expect(out.rows[0].source).toBe(
      "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24"
    );
    expect(out.rows[0].destination).toBe(
      "0x6b94d8192ed3691a2b66c942fd1775022cbdb5b4"
    );
    expect(out.rows[0].currency).toBe("USDC");
  });

  it("catch-all also recognizes usdcValue and amount as the balance change", async () => {
    const out = await transformLedgerUpdates(
      [
        mk({
          type: "someNewType",
          amount: "12.5",
        } as unknown as HlLedgerUpdate["delta"]),
      ],
      "Main"
    );
    expect(out.skippedUnknown).toBe(0);
    expect(out.rows[0].account_value_change).toBe(12.5);
  });

  it("skips updates with no usdc and unknown type", async () => {
    const out = await transformLedgerUpdates(
      [mk({ type: "mysteryEvent" } as unknown as HlLedgerUpdate["delta"])],
      "Main"
    );
    expect(out.skippedUnknown).toBe(1);
    expect(out.rows).toHaveLength(0);
  });
});

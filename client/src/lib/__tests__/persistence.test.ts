import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const getFirstListItemMock = vi.fn();
const getFullListMock = vi.fn();

vi.mock("../pb", () => ({
  pb: {
    collection: vi.fn(() => ({
      create: createMock,
      getFirstListItem: getFirstListItemMock,
      getFullList: getFullListMock,
    })),
  },
  PB_URL: "http://test",
}));

import { commitGroup } from "../persistence";
import type { ParsedTrade } from "../csv";

const sampleRow = (i: number): ParsedTrade => ({
  time: `2026-04-02T12:14:${String(i).padStart(2, "0")}+09:00`,
  coin: "ETH",
  dir: "Open Long",
  px: 2000 + i,
  sz: 0.01,
  ntl: 20,
  fee: 0.01,
  closed_pnl: 0,
  hash: `hash-${i}`,
});

describe("commitGroup — requestKey:null regression", () => {
  beforeEach(() => {
    createMock.mockReset();
    getFirstListItemMock.mockReset();
    getFullListMock.mockReset();

    // ensureAccount: account does not exist → getFirstListItem rejects, then create succeeds
    getFirstListItemMock.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 })
    );
    // first create call is for the account; subsequent ones are for trades
    createMock
      .mockResolvedValueOnce({ id: "acc1" }) // account
      .mockResolvedValue({ id: "rec" }); // trades

    // no existing trade hashes
    getFullListMock.mockResolvedValue([]);
  });

  it("passes requestKey:null to every write to disable SDK auto-cancellation", async () => {
    const rows = [sampleRow(1), sampleRow(2), sampleRow(3), sampleRow(4)];
    const result = await commitGroup("0xabc", "trade", rows);

    expect(result.inserted).toBe(4);
    expect(result.failed).toBe(0);

    // account create + 4 trade creates = 5 total
    expect(createMock).toHaveBeenCalledTimes(5);

    // Every create call must have requestKey:null in its options arg.
    for (const call of createMock.mock.calls) {
      const opts = call[1];
      expect(opts).toBeDefined();
      expect(opts).toMatchObject({ requestKey: null });
    }
  });

  it("passes requestKey:null when reading existing hashes too", async () => {
    await commitGroup("0xabc", "trade", [sampleRow(1)]);
    expect(getFullListMock).toHaveBeenCalledOnce();
    const opts = getFullListMock.mock.calls[0][0];
    expect(opts).toMatchObject({ requestKey: null });
  });

  it("deduplicates rows against existing hashes from the DB", async () => {
    getFullListMock.mockResolvedValueOnce([
      { hash: "hash-1" },
      { hash: "hash-2" },
    ]);
    const rows = [sampleRow(1), sampleRow(2), sampleRow(3)];
    const result = await commitGroup("0xabc", "trade", rows);
    expect(result.skippedDuplicates).toBe(2);
    expect(result.inserted).toBe(1);
  });

  it("deduplicates rows within the same batch", async () => {
    const rows = [sampleRow(1), sampleRow(1), sampleRow(2)];
    const result = await commitGroup("0xabc", "trade", rows);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.inserted).toBe(2);
  });
});

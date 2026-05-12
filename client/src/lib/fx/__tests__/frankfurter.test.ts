import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFrankfurterRange } from "../frankfurter";

describe("fetchFrankfurterRange", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses the range response into sorted FxRate entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          amount: 1.0,
          base: "USD",
          start_date: "2026-04-01",
          end_date: "2026-04-03",
          rates: {
            "2026-04-03": { JPY: 150.7 },
            "2026-04-01": { JPY: 150.5 },
          },
        }),
      })
    );
    const result = await fetchFrankfurterRange("2026-04-01", "2026-04-03");
    expect(result.startDate).toBe("2026-04-01");
    expect(result.endDate).toBe("2026-04-03");
    expect(result.rates).toEqual([
      { date: "2026-04-01", usd_jpy: 150.5 },
      { date: "2026-04-03", usd_jpy: 150.7 },
    ]);
  });

  it("skips entries without a JPY rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          start_date: "2026-04-01",
          end_date: "2026-04-02",
          rates: {
            "2026-04-01": { JPY: 150.5 },
            "2026-04-02": {},
          },
        }),
      })
    );
    const result = await fetchFrankfurterRange("2026-04-01", "2026-04-02");
    expect(result.rates).toHaveLength(1);
    expect(result.rates[0].date).toBe("2026-04-01");
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
    );
    await expect(
      fetchFrankfurterRange("2026-04-01", "2026-04-03")
    ).rejects.toThrow(/500/);
  });

  it("rejects invalid date formats", async () => {
    await expect(
      fetchFrankfurterRange("invalid", "2026-04-03")
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("rejects when from > to", async () => {
    await expect(
      fetchFrankfurterRange("2026-04-10", "2026-04-01")
    ).rejects.toThrow(/開始日/);
  });

  it("hits the correct API URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        start_date: "2026-04-01",
        end_date: "2026-04-01",
        rates: { "2026-04-01": { JPY: 150 } },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchFrankfurterRange("2026-04-01", "2026-04-03");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.frankfurter.dev/v1/2026-04-01..2026-04-03?from=USD&to=JPY"
    );
  });
});

/**
 * Integration test that runs against a *live* PocketBase instance.
 *
 * Why this exists:
 *   The original bug was in PocketBase JS SDK's auto-cancellation behavior,
 *   which cannot be reproduced with mocks. Hitting a real server is the only
 *   way to catch regressions here.
 *
 * Excluded from `npm test` by the `*.integration.test.ts` exclude pattern in
 * vite.config.ts. Run it manually with `npm run test:integration` after
 * `docker compose up -d`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pb } from "../pb";
import { parseTradeCsv } from "../csv";
import { commitGroup } from "../persistence";

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.resolve(here, "../../../../sample_csv");

const TRADE_ADDR_1 = "0x6b94D8192eD3691a2b66c942fd1775022CbDb5b4";
const TRADE_ADDR_2 = "0xA929Bd1dC1dC0DfA244F99350B9b698c9b493770";

async function wipeAll(): Promise<void> {
  for (const col of ["trades", "fundings", "transfers", "accounts"]) {
    const list = await pb
      .collection(col)
      .getFullList<{ id: string }>({ fields: "id", requestKey: null });
    await Promise.all(
      list.map((r) =>
        pb.collection(col).delete(r.id, { requestKey: null })
      )
    );
  }
}

describe("commitGroup integration (live PocketBase)", () => {
  beforeEach(wipeAll);
  afterEach(wipeAll);

  it("inserts all 12 rows of file 1 with no failures", async () => {
    const text = readFileSync(
      path.join(sampleDir, `trade_history_${TRADE_ADDR_1}.csv`),
      "utf8"
    );
    const parsed = await parseTradeCsv(text, TRADE_ADDR_1);
    expect(parsed.rows).toHaveLength(12);

    const result = await commitGroup(TRADE_ADDR_1, "trade", parsed.rows);
    if (result.errors.length) {
      console.error("Insert errors:", result.errors);
    }
    expect(result.failed).toBe(0);
    expect(result.inserted).toBe(12);
  }, 30000);

  it("inserts all 26 rows of file 2 with no failures", async () => {
    const text = readFileSync(
      path.join(sampleDir, `trade_history_${TRADE_ADDR_2} (2).csv`),
      "utf8"
    );
    const parsed = await parseTradeCsv(text, TRADE_ADDR_2);
    expect(parsed.rows).toHaveLength(26);

    const result = await commitGroup(TRADE_ADDR_2, "trade", parsed.rows);
    if (result.errors.length) {
      console.error("Insert errors:", result.errors);
    }
    expect(result.failed).toBe(0);
    expect(result.inserted).toBe(26);
  }, 30000);

  it("re-running the same import yields 0 inserts and N duplicates", async () => {
    const text = readFileSync(
      path.join(sampleDir, `trade_history_${TRADE_ADDR_1}.csv`),
      "utf8"
    );
    const parsed = await parseTradeCsv(text, TRADE_ADDR_1);
    const first = await commitGroup(TRADE_ADDR_1, "trade", parsed.rows);
    expect(first.inserted).toBe(12);

    const second = await commitGroup(TRADE_ADDR_1, "trade", parsed.rows);
    expect(second.inserted).toBe(0);
    expect(second.skippedDuplicates).toBe(12);
    expect(second.failed).toBe(0);
  }, 30000);

  it("parallel count queries return correct totals per account (Accounts page regression)", async () => {
    // Seed both accounts
    const text1 = readFileSync(
      path.join(sampleDir, `trade_history_${TRADE_ADDR_1}.csv`),
      "utf8"
    );
    const parsed1 = await parseTradeCsv(text1, TRADE_ADDR_1);
    const text2 = readFileSync(
      path.join(sampleDir, `trade_history_${TRADE_ADDR_2} (2).csv`),
      "utf8"
    );
    const parsed2 = await parseTradeCsv(text2, TRADE_ADDR_2);

    await commitGroup(TRADE_ADDR_1, "trade", parsed1.rows);
    await commitGroup(TRADE_ADDR_2, "trade", parsed2.rows);

    // Look up account IDs
    const accounts = await pb
      .collection("accounts")
      .getFullList<{ id: string; address: string }>();

    // Reproduce Accounts page behaviour: per-account, fire 3 parallel
    // getList calls to the same collection paths. With autoCancellation on,
    // requests for different accounts would cancel each other and return 0.
    const counts = await Promise.all(
      accounts.map(async (a) => {
        const [trades, fundings, transfers] = await Promise.all([
          pb
            .collection("trades")
            .getList(1, 1, { filter: `account = "${a.id}"` })
            .then((r) => r.totalItems),
          pb
            .collection("fundings")
            .getList(1, 1, { filter: `account = "${a.id}"` })
            .then((r) => r.totalItems),
          pb
            .collection("transfers")
            .getList(1, 1, { filter: `account = "${a.id}"` })
            .then((r) => r.totalItems),
        ]);
        return { address: a.address, trades, fundings, transfers };
      })
    );

    const byAddr = new Map(counts.map((c) => [c.address, c]));
    expect(byAddr.get(TRADE_ADDR_1)?.trades).toBe(12);
    expect(byAddr.get(TRADE_ADDR_2)?.trades).toBe(26);
  }, 30000);
});

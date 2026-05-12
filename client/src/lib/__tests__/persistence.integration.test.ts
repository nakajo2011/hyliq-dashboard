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

// These are used as account names (not addresses). Keeping the address-like
// strings preserves uniqueness for the integration test.
const ACCOUNT_NAME_1 = "test-6b94";
const ACCOUNT_NAME_2 = "test-a929";
const FILE_1 = "trade_history_0x6b94D8192eD3691a2b66c942fd1775022CbDb5b4.csv";
const FILE_2 =
  "trade_history_0xA929Bd1dC1dC0DfA244F99350B9b698c9b493770 (2).csv";

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
    const text = readFileSync(path.join(sampleDir, FILE_1), "utf8");
    const parsed = await parseTradeCsv(text, ACCOUNT_NAME_1);
    expect(parsed.rows).toHaveLength(12);

    const result = await commitGroup(ACCOUNT_NAME_1, "trade", parsed.rows);
    if (result.errors.length) {
      console.error("Insert errors:", result.errors);
    }
    expect(result.failed).toBe(0);
    expect(result.inserted).toBe(12);
  }, 30000);

  it("inserts all 26 rows of file 2 with no failures", async () => {
    const text = readFileSync(path.join(sampleDir, FILE_2), "utf8");
    const parsed = await parseTradeCsv(text, ACCOUNT_NAME_2);
    expect(parsed.rows).toHaveLength(26);

    const result = await commitGroup(ACCOUNT_NAME_2, "trade", parsed.rows);
    if (result.errors.length) {
      console.error("Insert errors:", result.errors);
    }
    expect(result.failed).toBe(0);
    expect(result.inserted).toBe(26);
  }, 30000);

  it("re-running the same import yields 0 inserts and N duplicates", async () => {
    const text = readFileSync(path.join(sampleDir, FILE_1), "utf8");
    const parsed = await parseTradeCsv(text, ACCOUNT_NAME_1);
    const first = await commitGroup(ACCOUNT_NAME_1, "trade", parsed.rows);
    expect(first.inserted).toBe(12);

    const second = await commitGroup(ACCOUNT_NAME_1, "trade", parsed.rows);
    expect(second.inserted).toBe(0);
    expect(second.skippedDuplicates).toBe(12);
    expect(second.failed).toBe(0);
  }, 30000);

  it("parallel count queries return correct totals per account (Accounts page regression)", async () => {
    const text1 = readFileSync(path.join(sampleDir, FILE_1), "utf8");
    const parsed1 = await parseTradeCsv(text1, ACCOUNT_NAME_1);
    const text2 = readFileSync(path.join(sampleDir, FILE_2), "utf8");
    const parsed2 = await parseTradeCsv(text2, ACCOUNT_NAME_2);

    await commitGroup(ACCOUNT_NAME_1, "trade", parsed1.rows);
    await commitGroup(ACCOUNT_NAME_2, "trade", parsed2.rows);

    const accounts = await pb
      .collection("accounts")
      .getFullList<{ id: string; name: string }>();

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
        return { name: a.name, trades, fundings, transfers };
      })
    );

    const byName = new Map(counts.map((c) => [c.name, c]));
    expect(byName.get(ACCOUNT_NAME_1)?.trades).toBe(12);
    expect(byName.get(ACCOUNT_NAME_2)?.trades).toBe(26);
  }, 30000);
});

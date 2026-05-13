import { pb } from "./pb";
import type {
  CsvKind,
  ParsedFunding,
  ParsedTrade,
  ParsedTransfer,
  ParsedRow,
} from "./csv";

const COLLECTION_BY_KIND: Record<CsvKind, string> = {
  trade: "trades",
  funding: "fundings",
  transfer: "transfers",
};

export interface CommitGroupResult {
  accountName: string;
  kind: CsvKind;
  accountId: string;
  /** New rows actually written to the DB. */
  inserted: number;
  /** Rows skipped because their hash already exists. */
  skippedDuplicates: number;
  /** Rows that failed to insert. */
  failed: number;
  errors: { hash: string; message: string }[];
}

/**
 * The PocketBase JS SDK auto-cancels concurrent requests that share the same
 * URL (method + path) by default. When we fire many parallel `create()` calls
 * against the same collection, all but the last one get aborted with
 * "The request was aborted (most likely auto-cancelled)" and the inserts are
 * silently lost. Passing `requestKey: null` opts that specific call out of the
 * auto-cancel pool so true parallelism works.
 */
const NO_CANCEL = { requestKey: null } as const;

async function ensureAccount(accountName: string): Promise<{ id: string }> {
  const normalized = accountName.trim();
  if (!normalized) throw new Error("アカウント名が空です");
  try {
    const existing = await pb
      .collection("accounts")
      .getFirstListItem(`name = "${normalized}"`, NO_CANCEL);
    return { id: existing.id };
  } catch {
    // Not found → create
    const created = await pb
      .collection("accounts")
      .create({ name: normalized }, NO_CANCEL);
    return { id: created.id };
  }
}

async function fetchExistingHashes(
  collection: string,
  accountId: string
): Promise<Set<string>> {
  const list = await pb.collection(collection).getFullList<{ hash: string }>({
    filter: `account = "${accountId}"`,
    fields: "hash",
    batch: 500,
    requestKey: null,
  });
  return new Set(list.map((r) => r.hash));
}

function toRecord(
  kind: CsvKind,
  accountId: string,
  row: ParsedRow
): Record<string, unknown> {
  if (kind === "trade") {
    const r = row as ParsedTrade;
    return {
      account: accountId,
      time: r.time,
      coin: r.coin,
      dir: r.dir,
      px: r.px,
      sz: r.sz,
      ntl: r.ntl,
      fee: r.fee,
      closed_pnl: r.closed_pnl,
      hash: r.hash,
    };
  }
  if (kind === "funding") {
    const r = row as ParsedFunding;
    return {
      account: accountId,
      time: r.time,
      coin: r.coin,
      sz: r.sz,
      side: r.side || undefined,
      payment: r.payment,
      rate: r.rate,
      hash: r.hash,
    };
  }
  const r = row as ParsedTransfer;
  return {
    account: accountId,
    time: r.time,
    action: r.action,
    source: r.source,
    destination: r.destination,
    account_value_change: r.account_value_change,
    fee: r.fee,
    currency: r.currency,
    hash: r.hash,
  };
}

async function chunkedAll<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

export async function commitGroup(
  accountName: string,
  kind: CsvKind,
  rows: ParsedRow[]
): Promise<CommitGroupResult> {
  const account = await ensureAccount(accountName);
  const collection = COLLECTION_BY_KIND[kind];
  const existing = await fetchExistingHashes(collection, account.id);

  // Deduplicate within the incoming batch as well (multiple files for same account)
  const seenInBatch = new Set<string>();
  const toInsert: ParsedRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (existing.has(row.hash) || seenInBatch.has(row.hash)) {
      skipped++;
      continue;
    }
    seenInBatch.add(row.hash);
    toInsert.push(row);
  }

  const errors: CommitGroupResult["errors"] = [];
  let inserted = 0;
  let failed = 0;

  await chunkedAll(toInsert, 6, async (row) => {
    try {
      await pb
        .collection(collection)
        .create(toRecord(kind, account.id, row), NO_CANCEL);
      inserted++;
    } catch (e) {
      failed++;
      errors.push({
        hash: row.hash,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return {
    accountName,
    kind,
    accountId: account.id,
    inserted,
    skippedDuplicates: skipped,
    failed,
    errors,
  };
}

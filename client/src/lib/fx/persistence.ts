import { pb } from "../pb";

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Upsert a USD/JPY rate keyed by date (YYYY-MM-DD).
 *
 * Look up any existing rate whose date falls within the given day (range
 * filter handles PocketBase storing dates as timestamps); update it in-place
 * if found, otherwise create a new one. The rate is stored at UTC midnight
 * so its YYYY-MM-DD slice is stable regardless of the viewer's timezone.
 */
export async function upsertFxRate(
  date: string,
  usd_jpy: number
): Promise<void> {
  const isoDate = `${date} 00:00:00.000Z`;
  try {
    const existing = await pb
      .collection("fx_rates")
      .getFirstListItem(`date >= "${date}" && date < "${nextDay(date)}"`);
    await pb.collection("fx_rates").update(existing.id, {
      date: isoDate,
      usd_jpy,
      source: "manual",
    });
  } catch {
    await pb.collection("fx_rates").create({
      date: isoDate,
      usd_jpy,
      source: "manual",
    });
  }
}

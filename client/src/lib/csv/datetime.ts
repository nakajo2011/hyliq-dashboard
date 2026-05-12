/**
 * Hyperliquid CSV exports use a JST-like local format: "2026/4/2 12:14:01"
 * (year/month/day with no leading zeros). Convert to ISO 8601 with the
 * +09:00 offset so PocketBase stores it unambiguously.
 *
 * Hyperliquid CSV のタイムスタンプは "2026/4/2 12:14:01" の日本時間表記。
 * PocketBase に渡すために ISO 8601 (+09:00) に変換する。
 */
export function parseHyperliquidTime(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/
  );
  if (!m) {
    throw new Error(`Unrecognized time format: ${raw}`);
  }
  const [, y, mo, d, h, mi, s] = m;
  const pad = (v: string) => v.padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${s}+09:00`;
}

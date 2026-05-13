import type { FxRate } from "./types";

export interface MizuhoParseResult {
  rates: FxRate[];
  /** Per-line problems that couldn't be salvaged but didn't abort the parse. */
  errors: string[];
  /** Inclusive date range of the parsed rates (YYYY-MM-DD). */
  range?: { start: string; end: string };
}

/**
 * Parse Mizuho Bank's `quote.csv` (the daily 公示仲値/TTM file at
 * https://www.mizuhobank.co.jp/market/quote.csv).
 *
 * Format quirks handled:
 *   - Shift_JIS encoding (decoded if the input is an ArrayBuffer)
 *   - First column is the date in YYYY/M/D (no zero-padding)
 *   - Currency columns include Japanese labels in row 2 (`米ドル, …`) and ISO
 *     codes in row 3 (`USD, GBP, …`); we look up USD from row 3
 *   - Missing rates appear as `*****` (skip)
 *   - Last column may be `RUB` blank if delisted (skip)
 *
 * Input can be either a string (already decoded) or an ArrayBuffer (raw bytes
 * from a File). The "binary string" fallback isn't needed here because every
 * supported browser exposes TextDecoder('shift_jis') natively.
 */
export function parseMizuhoCsv(
  input: ArrayBuffer | string
): MizuhoParseResult {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = new TextDecoder("shift_jis").decode(input);
    } catch (e) {
      return {
        rates: [],
        errors: [
          "Shift_JIS のデコードに失敗しました: " +
            (e instanceof Error ? e.message : String(e)),
        ],
      };
    }
  }

  const lines = text.split(/\r?\n/);

  // Find USD column from the ISO code header row.
  let usdCol = -1;
  let dataStart = -1;
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const idx = cells.indexOf("USD");
    if (idx >= 0) {
      usdCol = idx;
      dataStart = i + 1;
      break;
    }
  }

  if (usdCol < 0) {
    return {
      rates: [],
      errors: [
        "USD 列が見つかりませんでした (みずほ quote.csv 以外のファイルかもしれません)",
      ],
    };
  }

  const dateRe = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
  const rates: FxRate[] = [];
  const errors: string[] = [];

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split(",");
    if (cells.length <= usdCol) continue;

    const dateRaw = cells[0].trim();
    const usdRaw = cells[usdCol].trim();

    const m = dateRe.exec(dateRaw);
    if (!m) continue;
    if (!usdRaw || usdRaw.indexOf("*") >= 0) continue;

    const rate = parseFloat(usdRaw);
    if (!isFinite(rate) || rate <= 0) {
      errors.push(`Line ${i + 1}: 不正な USD 値 "${usdRaw}"`);
      continue;
    }

    const iso =
      m[1] +
      "-" +
      m[2].padStart(2, "0") +
      "-" +
      m[3].padStart(2, "0");
    rates.push({ date: iso, usd_jpy: rate });
  }

  return {
    rates,
    errors,
    range:
      rates.length > 0
        ? { start: rates[0].date, end: rates[rates.length - 1].date }
        : undefined,
  };
}

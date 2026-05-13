/** USD with 2 decimal places, e.g. "1,234.56". */
export function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/** JPY as integer with thousands separators, e.g. "1,234,567". */
export function fmtJpy(n: number): string {
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

/** Integer with thousands separators. */
export function fmtInt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Generic decimal formatter with configurable precision. */
export function fmtNum(n: number, decimals = 4): string {
  return n.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

/** Take just the YYYY-MM-DD portion from a PocketBase date string. */
export function dateOnly(s: string): string {
  return s.slice(0, 10);
}

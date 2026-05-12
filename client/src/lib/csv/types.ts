export type CsvKind = "trade" | "funding" | "transfer";

export type TradeDir =
  | "Open Long"
  | "Close Long"
  | "Open Short"
  | "Close Short"
  | "Long > Short"
  | "Short > Long";

export interface ParsedTrade {
  time: string; // ISO 8601
  coin: string;
  dir: TradeDir;
  px: number;
  sz: number;
  ntl: number;
  fee: number;
  closed_pnl: number;
  hash: string;
}

export interface ParsedFunding {
  time: string;
  coin: string;
  sz: number;
  side: "Long" | "Short" | "";
  payment: number;
  rate: number;
  hash: string;
}

export interface ParsedTransfer {
  time: string;
  action: string;
  source: string;
  destination: string;
  account_value_change: number;
  fee: number;
  currency: string;
  hash: string;
}

export type ParsedRow = ParsedTrade | ParsedFunding | ParsedTransfer;

export interface ParseResult<T extends ParsedRow> {
  kind: CsvKind;
  rows: T[];
  errors: { line: number; message: string }[];
  /** Auto-detected account address (only set for trade history files) */
  detectedAddress?: string;
}

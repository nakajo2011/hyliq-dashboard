export interface FxRate {
  /** YYYY-MM-DD */
  date: string;
  usd_jpy: number;
}

export interface FxRateRecord extends FxRate {
  id: string;
  source?: "manual" | "api" | "";
  note?: string;
}

export interface FxResolution {
  rate: number;
  /** The date of the rate actually used (may be earlier than the requested date). */
  fxDate: string;
  /** True if the requested date had no exact match and we fell back to a prior date. */
  carriedForward: boolean;
}

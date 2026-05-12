import PocketBase from "pocketbase";

const url = import.meta.env.VITE_POCKETBASE_URL ?? "http://127.0.0.1:8090";

export const pb = new PocketBase(url);

/**
 * Disable the SDK's default auto-cancellation globally.
 *
 * By default the SDK keys requests by method+path and cancels older ones when
 * a duplicate is in flight. That silently aborts our parallel writes (e.g.
 * 6 concurrent CREATE on the same collection) and our parallel reads (e.g.
 * the per-account count queries on the Accounts page). We do not rely on
 * auto-cancel anywhere in the app — if we ever need it, opt in per-call with
 * an explicit `requestKey`.
 */
pb.autoCancellation(false);

export const PB_URL = url;

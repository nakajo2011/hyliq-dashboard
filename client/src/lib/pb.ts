import PocketBase from "pocketbase";

const url = import.meta.env.VITE_POCKETBASE_URL ?? "http://127.0.0.1:8090";

export const pb = new PocketBase(url);

export const PB_URL = url;

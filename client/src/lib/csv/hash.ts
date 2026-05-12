/**
 * Deterministic SHA-256 hash (hex) for a list of string fields.
 * Used to deduplicate rows across re-uploads.
 *
 * The same logical row from the same account must always produce the
 * same hash, so include the account address as a field and use a stable
 * field order.
 */
export async function sha256Hex(parts: (string | number)[]): Promise<string> {
  const joined = parts.map((p) => String(p)).join("");
  const data = new TextEncoder().encode(joined);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

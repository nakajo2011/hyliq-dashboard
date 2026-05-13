/// <reference path="../pb_data/types.d.ts" />

/**
 * POST /api/sync-fx-mufg
 *
 * Optional JSON body:
 *   { "dates": ["2026-04-01", "2026-04-02", ...] }
 * If omitted, the endpoint derives dates from all trade rows (JST date keys).
 *
 * Query: ?skipExisting=true|false (default true)
 *
 * Fetches each MURC daily page (https://www.murc-kawasesouba.jp/fx/past/
 * index.php?id=YYMMDD), pulls the USD TTS/TTB values, computes the TTM
 * as (TTS+TTB)/2 — which is the standard MUFG "公示仲値" rate used for
 * Japanese tax filings — and upserts into fx_rates.
 *
 * Non-business days return a 302 redirect; we detect that as "USD row not
 * found in HTML" and silently skip them (carry-forward handles those at
 * lookup time).
 *
 * The CSV/HTML is EUC-JP encoded, but every byte we care about (digits,
 * dots, the literal "USD", and HTML brackets) is ASCII, so a "binary
 * string" reinterpretation is enough — we don't need a full EUC-JP decoder.
 */
routerAdd("POST", "/api/sync-fx-mufg", (e) => {
  // ---- 1. Resolve target dates ---------------------------------------
  let dates = null;
  try {
    const body = e.requestInfo().body;
    if (body && Array.isArray(body.dates)) {
      dates = body.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    }
  } catch (_) {
    // no body provided
  }

  if (!dates || dates.length === 0) {
    // Default: every distinct JST date in the trades collection.
    const tradeDates = new Set();
    const trades = $app.findAllRecords("trades");
    for (const t of trades) {
      const dt = t.getDateTime("time").time(); // returns Go time.Time
      // PocketBase stores trade times in UTC; convert to JST by adding 9h.
      const ms = dt.unix() * 1000 + 9 * 60 * 60 * 1000;
      const d = new Date(ms);
      const iso =
        d.getUTCFullYear() +
        "-" +
        ("0" + (d.getUTCMonth() + 1)).slice(-2) +
        "-" +
        ("0" + d.getUTCDate()).slice(-2);
      tradeDates.add(iso);
    }
    dates = Array.from(tradeDates).sort();
  }

  if (dates.length === 0) {
    return e.json(400, {
      error: "No dates provided and no trades found in DB",
    });
  }

  // ---- 2. Optional skip-existing -------------------------------------
  const skipExisting =
    e.request.url.query().get("skipExisting") !== "false"; // default true
  let existing = new Set();
  if (skipExisting) {
    const records = $app.findAllRecords("fx_rates");
    for (const r of records) {
      existing.add(r.getDateTime("date").string().slice(0, 10));
    }
  }

  const collection = $app.findCollectionByNameOrId("fx_rates");
  let fetched = 0;
  let saved = 0;
  let skipped = 0;
  let nonBusiness = 0;
  const failures = [];

  // ---- 3. Per-date fetch + parse + upsert ----------------------------
  for (const date of dates) {
    if (skipExisting && existing.has(date)) {
      skipped++;
      continue;
    }

    // YYMMDD (last two digits of year + zero-padded month/day)
    const [y, mo, d] = date.split("-");
    const id = y.slice(2) + mo + d;
    const url =
      "https://www.murc-kawasesouba.jp/fx/past/index.php?id=" + id;

    let res;
    try {
      res = $http.send({
        url: url,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "ja,en;q=0.5",
        },
        timeout: 30,
      });
      fetched++;
    } catch (err) {
      failures.push({ date: date, error: String(err) });
      continue;
    }

    if (res.statusCode !== 200) {
      failures.push({ date: date, error: "HTTP " + res.statusCode });
      continue;
    }

    // Bytes → binary string (preserves all ASCII bytes incl. tags, digits)
    const bytes = res.body;
    const parts = new Array(Math.ceil(bytes.length / 8192));
    for (let i = 0, p = 0; i < bytes.length; i += 8192, p++) {
      parts[p] = String.fromCharCode.apply(
        null,
        bytes.slice(i, i + 8192)
      );
    }
    const text = parts.join("");

    // Find USD row: pattern "USD" then 2 numeric <td class="t_right">
    // values. Regex is tolerant of whitespace and minor tag attribute
    // differences seen across years of MURC pages.
    const usdRe =
      />\s*USD\s*<\/td>[\s\S]{0,400}?>\s*([0-9]+\.[0-9]+)\s*<\/td>[\s\S]{0,200}?>\s*([0-9]+\.[0-9]+)\s*<\/td>/;
    const m = usdRe.exec(text);
    if (!m) {
      // Likely a non-business-day 302 → followed redirect served an index
      // page without the USD row.
      nonBusiness++;
      continue;
    }
    const tts = parseFloat(m[1]);
    const ttb = parseFloat(m[2]);
    if (!isFinite(tts) || !isFinite(ttb) || tts <= 0 || ttb <= 0) {
      failures.push({ date: date, error: "Invalid TTS/TTB parsed" });
      continue;
    }
    const ttm = (tts + ttb) / 2;

    // Upsert (per-date try/catch so one bad row doesn't 500 the whole call)
    try {
      const startTs = date + " 00:00:00.000Z";
      // Compute next day inline — top-level fns aren't visible inside the
      // hook handler in PocketBase's JSVM.
      const _nd = new Date(date + "T00:00:00Z");
      _nd.setUTCDate(_nd.getUTCDate() + 1);
      const endTs = _nd.toISOString().slice(0, 10) + " 00:00:00.000Z";
      let rec = null;
      try {
        rec = $app.findFirstRecordByFilter(
          "fx_rates",
          "date >= {:start} && date < {:end}",
          { start: startTs, end: endTs }
        );
      } catch (_) {
        rec = null;
      }
      const note =
        "MUFG TTM (" + tts.toFixed(2) + " / " + ttb.toFixed(2) + ")";
      if (rec) {
        rec.set("usd_jpy", ttm);
        rec.set("source", "api");
        rec.set("note", note);
        $app.save(rec);
      } else {
        const newRec = new Record(collection);
        newRec.set("date", startTs);
        newRec.set("usd_jpy", ttm);
        newRec.set("source", "api");
        newRec.set("note", note);
        $app.save(newRec);
      }
      saved++;
    } catch (err) {
      failures.push({ date: date, error: "Upsert: " + String(err) });
    }
  }

  return e.json(200, {
    requestedDates: dates.length,
    fetched: fetched,
    saved: saved,
    skipped: skipped,
    nonBusiness: nonBusiness,
    failed: failures.length,
    failures: failures.slice(0, 10),
  });
});

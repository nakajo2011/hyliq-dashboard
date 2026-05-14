/// <reference path="../pb_data/types.d.ts" />

// Auto-provision a local default superuser so the PocketBase admin UI
// (http://localhost:8090/_/) is usable immediately after a fresh start or
// pb_data wipe — no manual "create the first admin" step required.
//
// ⚠️ Personal / local-use only. The credentials are committed to the repo,
// so do NOT expose this PocketBase instance to the public internet.
//
// Credentials:
//   email:    admin@local.app
//   password: hyliqdashboard

const DEFAULT_EMAIL = "admin@local.app";
const DEFAULT_PASSWORD = "hyliqdashboard";

migrate(
  (app) => {
    const superusers = app.findCollectionByNameOrId("_superusers");

    // If a record with this email already exists, leave it alone — e.g. the
    // user may have rotated the password manually.
    try {
      const existing = app.findFirstRecordByFilter(
        "_superusers",
        `email = "${DEFAULT_EMAIL}"`
      );
      if (existing) return;
    } catch (_) {
      // not found — proceed to create
    }

    const record = new Record(superusers);
    record.set("email", DEFAULT_EMAIL);
    record.setPassword(DEFAULT_PASSWORD);
    app.save(record);
  },
  (app) => {
    try {
      const existing = app.findFirstRecordByFilter(
        "_superusers",
        `email = "${DEFAULT_EMAIL}"`
      );
      app.delete(existing);
    } catch (_) {
      // already removed
    }
  }
);

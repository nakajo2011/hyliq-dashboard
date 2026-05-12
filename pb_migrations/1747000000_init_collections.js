/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // ---------- accounts ----------
    // `name` is the user-chosen identifier (must be entered on upload, not auto-derived).
    // `address` is optional metadata so users can record the ETH/wallet address if desired.
    const accounts = new Collection({
      name: "accounts",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "name", type: "text", required: true, max: 100 },
        { name: "address", type: "text", max: 100 },
        { name: "note", type: "text", max: 2000 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_accounts_name` ON `accounts` (`name`)",
      ],
    });
    app.save(accounts);

    // ---------- trades ----------
    const trades = new Collection({
      name: "trades",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        {
          name: "account",
          type: "relation",
          required: true,
          collectionId: accounts.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: "time", type: "date", required: true },
        { name: "coin", type: "text", required: true, max: 30 },
        {
          name: "dir",
          type: "select",
          required: true,
          maxSelect: 1,
          values: [
            "Open Long",
            "Close Long",
            "Open Short",
            "Close Short",
            "Long > Short",
            "Short > Long",
          ],
        },
        { name: "px", type: "number", required: true },
        { name: "sz", type: "number", required: true },
        { name: "ntl", type: "number" },
        { name: "fee", type: "number" },
        { name: "closed_pnl", type: "number" },
        { name: "hash", type: "text", required: true, max: 128 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_trades_hash` ON `trades` (`hash`)",
        "CREATE INDEX `idx_trades_account_time` ON `trades` (`account`,`time`)",
      ],
    });
    app.save(trades);

    // ---------- fundings ----------
    const fundings = new Collection({
      name: "fundings",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        {
          name: "account",
          type: "relation",
          required: true,
          collectionId: accounts.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: "time", type: "date", required: true },
        { name: "coin", type: "text", required: true, max: 30 },
        { name: "sz", type: "number" },
        {
          name: "side",
          type: "select",
          maxSelect: 1,
          values: ["Long", "Short"],
        },
        { name: "payment", type: "number" },
        { name: "rate", type: "number" },
        { name: "hash", type: "text", required: true, max: 128 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_fundings_hash` ON `fundings` (`hash`)",
        "CREATE INDEX `idx_fundings_account_time` ON `fundings` (`account`,`time`)",
      ],
    });
    app.save(fundings);

    // ---------- transfers ----------
    const transfers = new Collection({
      name: "transfers",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        {
          name: "account",
          type: "relation",
          required: true,
          collectionId: accounts.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: "time", type: "date", required: true },
        { name: "action", type: "text", max: 50 },
        { name: "source", type: "text", max: 100 },
        { name: "destination", type: "text", max: 100 },
        { name: "account_value_change", type: "number" },
        { name: "fee", type: "number" },
        { name: "currency", type: "text", max: 20 },
        { name: "hash", type: "text", required: true, max: 128 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_transfers_hash` ON `transfers` (`hash`)",
        "CREATE INDEX `idx_transfers_account_time` ON `transfers` (`account`,`time`)",
      ],
    });
    app.save(transfers);

    // ---------- fx_rates ----------
    const fxRates = new Collection({
      name: "fx_rates",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "date", type: "date", required: true },
        { name: "usd_jpy", type: "number", required: true },
        {
          name: "source",
          type: "select",
          maxSelect: 1,
          values: ["manual", "api"],
        },
        { name: "note", type: "text", max: 500 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_fx_rates_date` ON `fx_rates` (`date`)",
      ],
    });
    app.save(fxRates);
  },
  (app) => {
    for (const name of [
      "fx_rates",
      "transfers",
      "fundings",
      "trades",
      "accounts",
    ]) {
      try {
        const c = app.findCollectionByNameOrId(name);
        app.delete(c);
      } catch (_) {
        // already removed
      }
    }
  }
);

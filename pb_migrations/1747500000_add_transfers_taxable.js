/// <reference path="../pb_data/types.d.ts" />

/**
 * Add a `taxable` boolean to the transfers collection.
 *
 * Use case: most USDC deposits are self-transfers (moving own funds between
 * wallets), which are NOT taxable in Japan. But some incoming USDC may be
 * actual income (payment for services, gift, etc.) and DOES need to appear
 * on the tax return. The user marks each transfer row manually via UI.
 *
 * Defaults to false (= not taxable) so existing rows keep their current
 * meaning until the user explicitly opts in.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("transfers");
    collection.fields.add(
      new BoolField({
        name: "taxable",
      })
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("transfers");
    const field = collection.fields.getByName("taxable");
    if (field) {
      collection.fields.removeById(field.id);
      app.save(collection);
    }
  }
);

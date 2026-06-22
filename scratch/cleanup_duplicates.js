const db = require("../config/db");

async function run() {
  try {
    console.log("Deleting duplicate intermediate rows from tenant_subscription_history...");
    await db.query("DELETE FROM tenant_subscription_history WHERE id IN (1, 2, 3, 4, 7)");
    console.log("Duplicate rows deleted.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();

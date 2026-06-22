const db = require("../config/db");

async function run() {
  try {
    console.log("Cleaning up tenant_subscription_history...");
    
    // 1. Delete duplicate/intermediate test records
    await db.query(`
      DELETE FROM tenant_subscription_history 
      WHERE id IN (4, 5, 6)
    `);
    console.log("Deleted records 4, 5, and 6.");

    // 2. Set the first record (ID 1) back to 'Pro' plan
    await db.query(`
      UPDATE tenant_subscription_history 
      SET plan_tier = 'Pro' 
      WHERE id = 1
    `);
    console.log("Updated record 1 to Pro plan.");

    // 3. Set the active record (ID 7) details
    await db.query(`
      UPDATE tenant_subscription_history 
      SET plan_tier = 'Enterprise', billing_status = 'Collected', start_date = '2026-06-15 07:15:59', end_date = NULL 
      WHERE id = 7
    `);
    console.log("Updated active record 7 to Enterprise plan starting 15 Jun.");

    console.log("Cleanup finished successfully.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();

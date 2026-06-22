const db = require("../config/db");

async function run() {
  try {
    console.log("Resetting all tenant subscription plans to defaults (Basic, Pending, 0 days)...");
    
    // Reset columns in tenants table
    await db.query(`
      UPDATE tenants 
      SET plan_tier = 'Basic', 
          billing_status = 'Pending', 
          ends_in_days = 0
    `);
    console.log("Tenants table updated.");

    // Truncate history table again to ensure no records exist
    await db.query("TRUNCATE TABLE tenant_subscription_history");
    console.log("tenant_subscription_history table truncated.");

    console.log("All tenants subscription data has been cleared and reset.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();

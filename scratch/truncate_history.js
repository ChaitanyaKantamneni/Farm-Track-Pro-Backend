const db = require("../config/db");

async function run() {
  try {
    console.log("Truncating tenant_subscription_history table...");
    await db.query("TRUNCATE TABLE tenant_subscription_history");
    console.log("Table tenant_subscription_history truncated successfully.");
    
    // Also, when the history is empty, does the system automatically fall back to current values?
    // Yes, the frontend has fallback logic:
    // const history = t.subscriptionHistory && t.subscriptionHistory.length > 0 ? t.subscriptionHistory : ...
    // And when the user edits subscriptions in the UI now, the backend will automatically create 
    // an active history record in updateTenantSubscription if none exists!
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();

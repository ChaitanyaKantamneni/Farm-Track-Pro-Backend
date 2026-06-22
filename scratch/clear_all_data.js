const db = require("../config/db");

async function clearDatabase() {
  try {
    console.log("Starting database cleanup...");

    // Temporarily disable foreign key checks to ensure clean truncation
    await db.query("SET FOREIGN_KEY_CHECKS = 0");

    const tablesToTruncate = [
      "tenants",
      "items",
      "customers",
      "vendors",
      "sales",
      "purchases",
      "payments",
      "daybook",
      "staff",
      "advances",
      "salaries",
      "attendance",
      "sheds",
      "egg_collections",
      "tenant_settings",
      "inventory_disposals",
      "tenant_subscription_history"
    ];

    for (const table of tablesToTruncate) {
      console.log(`Truncating table: ${table}...`);
      await db.query(`TRUNCATE TABLE ${table}`);
    }

    // Keep only superadmin users in the users table
    console.log("Cleaning up users table (retaining SUPER_ADMIN)...");
    await db.query("DELETE FROM users WHERE role != 'SUPER_ADMIN' OR tenant_id IS NOT NULL");

    // Re-enable foreign key checks
    await db.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log("Database cleared successfully! Only the Super Admin account remains.");
    process.exit(0);
  } catch (err) {
    console.error("Database cleanup failed:", err);
    process.exit(1);
  }
}

clearDatabase();

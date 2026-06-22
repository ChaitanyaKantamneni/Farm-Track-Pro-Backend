const db = require("../config/db");

async function syncManagers() {
  try {
    console.log("Syncing MANAGER users to staff table...");
    // Find all users with MANAGER role
    const [managers] = await db.query("SELECT * FROM users WHERE role = 'MANAGER'");
    console.log(`Found ${managers.length} managers in users table.`);

    for (const manager of managers) {
      // Check if this manager already exists in staff
      const [existing] = await db.query(
        "SELECT id FROM staff WHERE tenant_id = ? AND name = ?",
        [manager.tenant_id, manager.full_name]
      );

      if (existing.length === 0) {
        console.log(`Creating staff entry for ${manager.full_name} (Tenant ID: ${manager.tenant_id})...`);
        await db.query(
          "INSERT INTO staff (tenant_id, name, phone, role_title, salary, join_date, status) VALUES (?, ?, ?, 'Manager', 0, CURDATE(), 'ACTIVE')",
          [manager.tenant_id, manager.full_name, manager.phone || null]
        );
      } else {
        console.log(`Staff entry already exists for ${manager.full_name}.`);
      }
    }

    console.log("Sync completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Sync failed:", err);
    process.exit(1);
  }
}

syncManagers();

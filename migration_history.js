const db = require("./config/db");

async function run() {
  try {
    console.log("Creating tenant_subscription_history table...");
    await db.query(`
      CREATE TABLE IF NOT EXISTS tenant_subscription_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        plan_tier VARCHAR(50) NOT NULL,
        billing_status VARCHAR(50) NOT NULL DEFAULT 'Collected',
        start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_date TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);
    console.log("Table tenant_subscription_history created or already exists.");

    console.log("Fetching existing tenants...");
    const [tenants] = await db.query("SELECT id, plan_tier, billing_status, created_at FROM tenants");
    console.log(`Found ${tenants.length} tenants. Seeding initial subscription records...`);

    for (const tenant of tenants) {
      const [history] = await db.query(
        "SELECT COUNT(*) AS count FROM tenant_subscription_history WHERE tenant_id = ?",
        [tenant.id]
      );

      if (history[0].count === 0) {
        console.log(`Seeding history for tenant ID ${tenant.id} (${tenant.plan_tier})...`);
        
        // Use the tenant's created_at for the start_date and created_at of their initial subscription record
        const tenantCreatedAt = tenant.created_at || new Date();
        await db.query(
          `INSERT INTO tenant_subscription_history 
           (tenant_id, plan_tier, billing_status, start_date, created_at) 
           VALUES (?, ?, ?, ?, ?)`,
          [tenant.id, tenant.plan_tier, tenant.billing_status, tenantCreatedAt, tenantCreatedAt]
        );
      }
    }

    console.log("Migration and seeding completed successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();

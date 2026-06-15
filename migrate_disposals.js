const db = require("./config/db");

async function migrate() {
  try {
    console.log("Running migrations...");

    // 1. Create tenant_settings table
    await db.query(`
      CREATE TABLE IF NOT EXISTS tenant_settings (
          tenant_id INT PRIMARY KEY,
          standard_egg_cost DECIMAL(10,2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("Created tenant_settings table");

    // 2. Create inventory_disposals table
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_disposals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenant_id INT NOT NULL,
          disposal_number VARCHAR(50) NOT NULL UNIQUE,
          disposal_type ENUM('EGG', 'PURCHASE_ITEM') NOT NULL,
          source_id INT NULL,
          item_snapshot_name VARCHAR(255) NOT NULL,
          quantity DECIMAL(12,2) NOT NULL,
          unit VARCHAR(50),
          unit_cost DECIMAL(12,2) DEFAULT 0,
          total_loss DECIMAL(12,2) DEFAULT 0,
          disposal_reason VARCHAR(255),
          disposal_date DATE NOT NULL,
          notes TEXT,
          status ENUM('ACTIVE', 'VOID') DEFAULT 'ACTIVE',
          created_by INT,
          updated_by INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("Created inventory_disposals table");

    console.log("Migration successful!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();

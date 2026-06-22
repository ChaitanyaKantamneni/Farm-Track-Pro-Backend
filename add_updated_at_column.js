const db = require("./config/db");

async function run() {
  try {
    console.log("Adding subscription_updated_at column to tenants table...");
    try {
      await db.query(`ALTER TABLE tenants ADD COLUMN subscription_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
      console.log("Added subscription_updated_at column.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("subscription_updated_at column already exists.");
      } else {
        throw e;
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();

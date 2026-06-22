const db = require("./config/db");

async function run() {
  try {
    console.log("Adding subscription columns to tenants table...");
    try {
      await db.query(`ALTER TABLE tenants ADD COLUMN plan_tier VARCHAR(50) NOT NULL DEFAULT 'Pro' AFTER status`);
      console.log("Added plan_tier column.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("plan_tier column already exists.");
      } else {
        throw e;
      }
    }

    try {
      await db.query(`ALTER TABLE tenants ADD COLUMN billing_status VARCHAR(50) NOT NULL DEFAULT 'Collected' AFTER plan_tier`);
      console.log("Added billing_status column.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("billing_status column already exists.");
      } else {
        throw e;
      }
    }

    try {
      await db.query(`ALTER TABLE tenants ADD COLUMN ends_in_days INT NOT NULL DEFAULT 30 AFTER billing_status`);
      console.log("Added ends_in_days column.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("ends_in_days column already exists.");
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

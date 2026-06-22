const db = require("../config/db");

async function run() {
  try {
    console.log("Removing ON UPDATE CURRENT_TIMESTAMP from subscription_updated_at...");
    await db.query(`
      ALTER TABLE tenants 
      MODIFY COLUMN subscription_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
    console.log("Column definition modified successfully.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();

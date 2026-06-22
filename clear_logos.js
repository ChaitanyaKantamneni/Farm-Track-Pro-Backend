const db = require("./config/db");

async function run() {
  try {
    console.log("Clearing all logos from tenants table in database...");
    await db.query(`UPDATE tenants SET logo = NULL`);
    console.log("All logos cleared successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to clear logos:", err);
    process.exit(1);
  }
}

run();

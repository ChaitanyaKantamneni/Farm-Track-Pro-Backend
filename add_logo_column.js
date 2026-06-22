const db = require("./config/db");

async function run() {
  try {
    console.log("Adding logo column to tenants table...");
    try {
      await db.query(`ALTER TABLE tenants ADD COLUMN logo LONGTEXT NULL AFTER status`);
      console.log("Added logo column successfully.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("Logo column already exists.");
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

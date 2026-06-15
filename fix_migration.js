const db = require("./config/db");

async function fix() {
  try {
    console.log("Fixing inventory_disposals schema...");
    
    // First let's see if the column exists by catching the error if it does
    try {
      await db.query(`ALTER TABLE inventory_disposals ADD COLUMN disposal_number VARCHAR(50) AFTER tenant_id`);
      console.log("Added disposal_number column.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("Column already exists.");
      } else {
        throw e;
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("Fix failed:", err);
    process.exit(1);
  }
}

fix();

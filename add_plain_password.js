const db = require("./config/db");

async function migrate() {
  try {
    console.log("Checking for plain_password column...");
    const [columns] = await db.query("SHOW COLUMNS FROM users LIKE 'plain_password'");
    if (columns.length === 0) {
      console.log("Adding plain_password column to users table...");
      await db.query("ALTER TABLE users ADD COLUMN plain_password VARCHAR(255) NULL");
      console.log("Column added successfully!");
      
      console.log("Initializing plain_password for existing users...");
      await db.query("UPDATE users SET plain_password = 'Farm@123' WHERE role = 'ADMIN' AND plain_password IS NULL");
      await db.query("UPDATE users SET plain_password = 'Manager@123' WHERE role = 'MANAGER' AND plain_password IS NULL");
      await db.query("UPDATE users SET plain_password = 'Admin@123' WHERE role = 'SUPER_ADMIN' AND plain_password IS NULL");
      console.log("Migration complete!");
    } else {
      console.log("plain_password column already exists.");
    }
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    process.exit();
  }
}

migrate();

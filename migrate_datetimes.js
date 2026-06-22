const db = require("./config/db");

async function run() {
  try {
    console.log("Altering date columns to DATETIME...");

    const tablesToAlter = [
      { table: "sales", column: "date" },
      { table: "purchases", column: "date" },
      { table: "payments", column: "date" },
      { table: "daybook", column: "date" },
      { table: "attendance", column: "date" },
      { table: "advances", column: "date" },
      { table: "salaries", column: "date" },
      { table: "egg_collections", column: "date" },
      { table: "inventory_disposals", column: "disposal_date" }
    ];

    for (const { table, column } of tablesToAlter) {
      console.log(`Altering ${table}.${column} to DATETIME...`);
      await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} DATETIME NOT NULL`);
    }

    console.log("Migrations successfully completed!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();

const db = require("../config/db");

async function run() {
  try {
    const [rows] = await db.query(`
      SELECT h.*, t.farm_name, t.tenant_code 
      FROM tenant_subscription_history h
      JOIN tenants t ON h.tenant_id = t.id
      ORDER BY h.tenant_id, h.start_date
    `);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();

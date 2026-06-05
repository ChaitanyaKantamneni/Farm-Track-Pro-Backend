const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

const tables = {
  items: "items",
  customers: "customers",
  vendors: "vendors",
  sales: "sales",
  purchases: "purchases",
  payments: "payments",
  daybook: "daybook",
  staff: "staff",
  advances: "advances",
  salaries: "salaries",
  attendance: "attendance"
};

const cols = {
  items: ["name", "unit", "price"],
  customers: ["name", "phone", "email", "address"],
  vendors: ["name", "phone", "email", "address"],
  sales: ["date", "customer_id", "customer_name", "item_id", "item_name", "qty", "unit", "price", "total", "paid", "balance", "notes"],
  purchases: ["date", "vendor_id", "vendor_name", "item_id", "item_name", "qty", "unit", "price", "cost", "paid", "balance", "notes"],
  payments: ["date", "type", "ref_id", "ref_name", "amount", "notes"],
  daybook: ["date", "kind", "category", "amount", "notes"],
  staff: ["name", "phone", "role_title", "salary", "join_date", "status"],
  advances: ["staff_id", "staff_name", "date", "amount", "notes"],
  salaries: ["staff_id", "staff_name", "month", "work_days", "present_days", "gross", "advance_deducted", "net", "date", "notes"],
  attendance: ["staff_id", "staff_name", "date", "status", "work_days", "notes"]
};

const money = (v) => Number(v || 0);
const numericCols = new Set([
  "price",
  "qty",
  "total",
  "paid",
  "balance",
  "cost",
  "amount",
  "salary",
  "work_days",
  "present_days",
  "gross",
  "advance_deducted",
  "net"
]);

function tenantId(req) {
  return req.user?.tenantId;
}

async function list(table, req, res) {
  const [rows] = await db.query(
    `SELECT * FROM ${tables[table]} WHERE tenant_id = ? ORDER BY id DESC`,
    [tenantId(req)]
  );
  res.json(rows);
}

async function create(table, req, res) {
  const data = {};
  cols[table].forEach((col) => {
    if (Object.prototype.hasOwnProperty.call(req.body, col)) {
      data[col] = cleanValue(col, req.body[col]);
    }
  });

  if (table === "sales") {
    data.total = money(data.qty) * money(data.price);
    data.balance = data.total - money(data.paid);
  }
  if (table === "purchases") {
    data.cost = money(data.qty) * money(data.price);
    data.balance = data.cost - money(data.paid);
  }
  if (table === "salaries") {
    data.net = money(data.gross) - money(data.advance_deducted);
  }

  const keys = ["tenant_id", ...Object.keys(data)];
  const values = [tenantId(req), ...Object.values(data)];
  const placeholders = keys.map(() => "?").join(",");

  const [result] = await db.query(
    `INSERT INTO ${tables[table]} (${keys.join(",")}) VALUES (${placeholders})`,
    values
  );

  if (table === "payments") await applyPayment(req, data);

  res.status(201).json({
    id: result.insertId,
    ...data
  });
}

async function update(table, req, res) {
  const data = {};
  cols[table].forEach((col) => {
    if (Object.prototype.hasOwnProperty.call(req.body, col)) {
      data[col] = cleanValue(col, req.body[col]);
    }
  });
  if (!Object.keys(data).length) return res.json({ success: true });

  const setSql = Object.keys(data).map((key) => `${key} = ?`).join(",");
  await db.query(
    `UPDATE ${tables[table]} SET ${setSql} WHERE id = ? AND tenant_id = ?`,
    [...Object.values(data), req.params.id, tenantId(req)]
  );
  res.json({ success: true });
}

function cleanValue(col, value) {
  if (numericCols.has(col)) {
    return value === "" || value === null || value === undefined ? 0 : Number(value);
  }

  return value === undefined ? null : value;
}

async function remove(table, req, res) {
  if (table === "payments") {
    await reversePayment(req);
  }

  await db.query(
    `DELETE FROM ${tables[table]} WHERE id = ? AND tenant_id = ?`,
    [req.params.id, tenantId(req)]
  );
  res.json({ success: true });
}

async function reversePayment(req) {
  const [payments] = await db.query(
    "SELECT * FROM payments WHERE id = ? AND tenant_id = ?",
    [req.params.id, tenantId(req)]
  );
  if (!payments.length) return;

  const payment = payments[0];
  const table = payment.type === "purchase" ? "purchases" : "sales";
  const grossCol = table === "sales" ? "total" : "cost";
  const [rows] = await db.query(
    `SELECT id, paid, ${grossCol} AS gross FROM ${table} WHERE id = ? AND tenant_id = ?`,
    [payment.ref_id, tenantId(req)]
  );
  if (!rows.length) return;

  const paid = Math.max(money(rows[0].paid) - money(payment.amount), 0);
  const balance = Math.max(money(rows[0].gross) - paid, 0);
  await db.query(
    `UPDATE ${table} SET paid = ?, balance = ? WHERE id = ? AND tenant_id = ?`,
    [paid, balance, payment.ref_id, tenantId(req)]
  );
}

async function applyPayment(req, payment) {
  const table = payment.type === "purchase" ? "purchases" : "sales";
  const [rows] = await db.query(
    `SELECT id, paid, ${table === "sales" ? "total" : "cost"} AS gross FROM ${table}
     WHERE id = ? AND tenant_id = ?`,
    [payment.ref_id, tenantId(req)]
  );
  if (!rows.length) return;
  const paid = money(rows[0].paid) + money(payment.amount);
  const balance = Math.max(money(rows[0].gross) - paid, 0);
  await db.query(
    `UPDATE ${table} SET paid = ?, balance = ? WHERE id = ? AND tenant_id = ?`,
    [paid, balance, payment.ref_id, tenantId(req)]
  );
}

router.get("/dashboard", auth, async (req, res) => {
  try {
    const tid = tenantId(req);
    const [[sale]] = await db.query("SELECT COALESCE(SUM(paid),0) paid, COALESCE(SUM(balance),0) balance FROM sales WHERE tenant_id = ?", [tid]);
    const [[purchase]] = await db.query("SELECT COALESCE(SUM(paid),0) paid, COALESCE(SUM(balance),0) balance FROM purchases WHERE tenant_id = ?", [tid]);
    const [[income]] = await db.query("SELECT COALESCE(SUM(amount),0) amount FROM daybook WHERE tenant_id = ? AND kind = 'income'", [tid]);
    const [[expense]] = await db.query("SELECT COALESCE(SUM(amount),0) amount FROM daybook WHERE tenant_id = ? AND kind = 'expense'", [tid]);
    const [[salary]] = await db.query("SELECT COALESCE(SUM(net),0) net FROM salaries WHERE tenant_id = ?", [tid]);
    const [sales] = await db.query("SELECT * FROM sales WHERE tenant_id = ? AND balance > 0 ORDER BY date DESC LIMIT 8", [tid]);
    const [purchases] = await db.query("SELECT * FROM purchases WHERE tenant_id = ? AND balance > 0 ORDER BY date DESC LIMIT 8", [tid]);
    res.json({
      metrics: {
        income: money(sale.paid) + money(income.amount),
        expense: money(purchase.paid) + money(expense.amount) + money(salary.net),
        receivables: money(sale.balance),
        payables: money(purchase.balance),
        salaryPaid: money(salary.net)
      },
      pendingReceivables: sales,
      outstandingPayables: purchases
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

Object.keys(tables).forEach((table) => {
  router.get(`/${table}`, auth, (req, res) => list(table, req, res).catch((error) => res.status(500).json({ message: error.message })));
  router.post(`/${table}`, auth, (req, res) => create(table, req, res).catch((error) => res.status(500).json({ message: error.message })));
  router.put(`/${table}/:id`, auth, (req, res) => update(table, req, res).catch((error) => res.status(500).json({ message: error.message })));
  router.delete(`/${table}/:id`, auth, (req, res) => remove(table, req, res).catch((error) => res.status(500).json({ message: error.message })));
});

module.exports = router;

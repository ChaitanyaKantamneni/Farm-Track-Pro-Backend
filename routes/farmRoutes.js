const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");
const bcrypt = require("bcrypt");

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
  attendance: "attendance",
  sheds: "sheds",
  egg_collections: "egg_collections"
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
  attendance: ["staff_id", "staff_name", "date", "status", "work_days", "notes"],
  sheds: ["name", "capacity"],
  egg_collections: ["shed_id", "shed_name", "date", "qty", "notes"]
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
  "net",
  "capacity"
]);

/**
 * Extracts the authenticated tenantId from request user parameters.
 * @param {Object} req - Express request.
 * @returns {number|null} Tenant ID snapshot.
 */
function tenantId(req) {
  return req.user?.tenantId;
}

/**
 * Generic controller to list records of a specific table scoped to the active tenant.
 * @param {string} table - Target database table.
 * @param {Object} req - Request.
 * @param {Object} res - Response.
 */
async function list(table, req, res) {
  const [rows] = await db.query(
    `SELECT * FROM ${tables[table]} WHERE tenant_id = ? ORDER BY id DESC`,
    [tenantId(req)]
  );
  res.json(rows);
}

/**
 * Generic controller to create a resource record scoped to the active tenant.
 * Automatically computes invoice totals and balances for Sales and Purchases.
 * @param {string} table - Target database table.
 * @param {Object} req - Request.
 * @param {Object} res - Response.
 */
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

/**
 * Generic controller to modify a specific resource record.
 * @param {string} table - Target database table.
 * @param {Object} req - Request.
 * @param {Object} res - Response.
 */
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

/**
 * Casts raw request values to appropriate types. Converts empty values to 0 for numeric columns.
 * @param {string} col - Column name.
 * @param {*} value - Raw value.
 * @returns {*} Cleaned/typed value.
 */
function cleanValue(col, value) {
  if (numericCols.has(col)) {
    return value === "" || value === null || value === undefined ? 0 : Number(value);
  }

  return value === undefined ? null : value;
}

/**
 * Generic controller to remove a specific resource record.
 * Automatically reverses invoice paid balances if a payment registry is deleted.
 * @param {string} table - Target database table.
 * @param {Object} req - Request.
 * @param {Object} res - Response.
 */
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

router.get("/users", auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, full_name, email, phone, role, plain_password, created_at FROM users WHERE tenant_id = ? ORDER BY id DESC",
      [tenantId(req)]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/users", auth, async (req, res) => {
  try {
    const { full_name, email, phone, role, password } = req.body;
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO users (tenant_id, full_name, email, phone, role, password_hash, plain_password) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [tenantId(req), full_name, email, phone || null, role, hash, password]
    );

    if (role === "MANAGER") {
      await db.query(
        "INSERT INTO staff (tenant_id, name, phone, role_title, salary, join_date, status) VALUES (?, ?, ?, ?, 0, CURDATE(), 'ACTIVE')",
        [tenantId(req), full_name, phone || null, "Manager"]
      );
    }

    res.status(201).json({ id: result.insertId, full_name, email, phone, role, plain_password: password });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/users/:id", auth, async (req, res) => {
  try {
    const { full_name, email, phone, role, password } = req.body;
    const { id } = req.params;

    const [existing] = await db.query("SELECT * FROM users WHERE id = ? AND tenant_id = ?", [id, tenantId(req)]);
    if (!existing.length) {
      return res.status(404).json({ message: "User not found" });
    }

    if (email && email !== existing[0].email) {
      const [emailCheck] = await db.query("SELECT id FROM users WHERE email = ? AND id != ?", [email, id]);
      if (emailCheck.length) {
        return res.status(400).json({ message: "Email already in use" });
      }
    }

    const updates = [];
    const params = [];

    if (full_name !== undefined) {
      updates.push("full_name = ?");
      params.push(full_name);
    }
    if (email !== undefined) {
      updates.push("email = ?");
      params.push(email);
    }
    if (phone !== undefined) {
      updates.push("phone = ?");
      params.push(phone);
    }
    if (role !== undefined) {
      updates.push("role = ?");
      params.push(role);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push("password_hash = ?");
      params.push(hash);
      updates.push("plain_password = ?");
      params.push(password);
    }

    if (updates.length > 0) {
      params.push(id, tenantId(req));
      await db.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`,
        params
      );
      
      // If full_name or phone is updated and user is a MANAGER, update staff table as well
      if (existing[0].role === "MANAGER") {
        const staffUpdates = [];
        const staffParams = [];
        if (full_name !== undefined) {
          staffUpdates.push("name = ?");
          staffParams.push(full_name);
        }
        if (phone !== undefined) {
          staffUpdates.push("phone = ?");
          staffParams.push(phone);
        }
        if (staffUpdates.length > 0) {
          staffParams.push(tenantId(req), existing[0].full_name, existing[0].phone || null);
          await db.query(
            `UPDATE staff SET ${staffUpdates.join(", ")} WHERE tenant_id = ? AND name = ? AND (phone = ? OR phone IS NULL)`,
            staffParams
          );
        }
      }
    }

    res.json({ success: true, message: "User updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete("/users/:id", auth, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user?.userId)) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }

    const [users] = await db.query("SELECT * FROM users WHERE id = ? AND tenant_id = ?", [req.params.id, tenantId(req)]);
    if (users.length && users[0].role === "MANAGER") {
      const user = users[0];
      await db.query(
        "UPDATE staff SET status = 'INACTIVE' WHERE tenant_id = ? AND name = ? AND (phone = ? OR phone IS NULL)",
        [tenantId(req), user.full_name, user.phone || null]
      );
    }

    await db.query("DELETE FROM users WHERE id = ? AND tenant_id = ?", [req.params.id, tenantId(req)]);
    res.json({ success: true });
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

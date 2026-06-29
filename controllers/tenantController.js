const bcrypt = require("bcrypt");
const db = require("../config/db");

/**
 * Registers a new tenant and configures default settings/administrators.
 * POST /api/tenants
 * Runs a transactional sequence to create a tenant, log subscription audit history,
 * salt standard admin credentials, and populate legacy master items.
 */
exports.createTenant = async (req, res) => {
  let connection;

  try {
    const {
      tenant_code,
      farm_name,
      owner_name,
      phone,
      email,
      logo,

      admin_name,
      admin_email,
      admin_phone
    } = req.body;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [tenantResult] = await connection.query(
      `
      INSERT INTO tenants
      (
        tenant_code,
        farm_name,
        owner_name,
        phone,
        email,
        logo
      )
      VALUES (?,?,?,?,?,?)
      `,
      [
        tenant_code,
        farm_name,
        owner_name,
        phone,
        email,
        logo || null
      ]
    );

    const tenantId = tenantResult.insertId;

    // Insert initial subscription history record
    await connection.query(
      `
      INSERT INTO tenant_subscription_history
      (
        tenant_id,
        plan_tier,
        billing_status
      )
      VALUES (?, 'Pro', 'Collected')
      `,
      [tenantId]
    );

    const defaultPassword = "Farm@123";
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    await connection.query(
      `
      INSERT INTO users
      (
        tenant_id,
        full_name,
        email,
        phone,
        password_hash,
        role,
        plain_password
      )
      VALUES (?,?,?,?,?,?,?)
      `,
      [
        tenantId,
        admin_name,
        admin_email,
        admin_phone,
        passwordHash,
        "ADMIN",
        defaultPassword
      ]
    );

    await connection.query(
      `
      INSERT INTO items
      (
        tenant_id,
        name,
        unit,
        price
      )
      VALUES
      (?, 'Eggs (Tray of 30)', 'tray', 0),
      (?, 'Chicken (Whole, dressed)', 'piece', 0),
      (?, 'Chicken (Live, per kg)', 'kg', 0)
      `,
      [
        tenantId,
        tenantId,
        tenantId
      ]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Tenant Created Successfully",
      tenantId: tenantId,
      credentials: {
        email: admin_email,
        password: defaultPassword
      }
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/**
 * Lists all tenants along with their nested subscription audit logs.
 * GET /api/tenants
 */
exports.getTenants = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT t.id, t.tenant_code, t.farm_name, t.owner_name, t.phone, t.email, t.status, t.logo,
             t.plan_tier AS plan, t.billing_status AS billingStatus, 
             GREATEST(0, t.ends_in_days - TIMESTAMPDIFF(DAY, t.subscription_updated_at, CURRENT_TIMESTAMP)) AS endsInDays,
             t.subscription_updated_at AS subscriptionUpdatedAt, t.created_at AS createdAt,
             u.full_name AS admin_name, u.email AS admin_email, u.phone AS admin_phone, u.plain_password AS admin_password
      FROM tenants t
      LEFT JOIN users u ON u.id = (
        SELECT id FROM users WHERE tenant_id = t.id AND role = 'ADMIN' ORDER BY id ASC LIMIT 1
      )
      ORDER BY t.id DESC
    `);
    
    // Fetch all subscription history records
    const [historyRows] = await db.query(`
      SELECT id, tenant_id, plan_tier AS plan, billing_status AS billingStatus, 
             start_date AS startDate, end_date AS endDate, created_at AS createdAt
      FROM tenant_subscription_history
      ORDER BY start_date ASC
    `);
    
    // Group history records by tenant_id
    const historyMap = {};
    historyRows.forEach(row => {
      if (!historyMap[row.tenant_id]) {
        historyMap[row.tenant_id] = [];
      }
      historyMap[row.tenant_id].push(row);
    });
    
    // Attach history to each tenant
    const tenantsWithHistory = rows.map(tenant => ({
      ...tenant,
      subscriptionHistory: historyMap[tenant.id] || []
    }));
    
    res.json(tenantsWithHistory);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Modifies the brand logo of a tenant.
 * PUT /api/tenants/:id/logo
 */
exports.updateTenantLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { logo } = req.body;
    await db.query("UPDATE tenants SET logo = ? WHERE id = ?", [logo, id]);
    res.json({ success: true, message: "Logo updated successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Modifies tenant subscription details (tier, days, status) and appends history details.
 * PUT /api/tenants/:id/subscription
 */
exports.updateTenantSubscription = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { plan, billingStatus, endsInDays, status } = req.body;

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Fetch current tenant state
    const [[currentTenant]] = await connection.query(
      "SELECT plan_tier, billing_status, ends_in_days, status FROM tenants WHERE id = ?",
      [id]
    );

    if (!currentTenant) {
      throw new Error("Tenant not found");
    }

    // 2. Update the main tenants table
    await connection.query(
      `UPDATE tenants 
       SET plan_tier = ?, billing_status = ?, ends_in_days = ?, status = ?, subscription_updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [plan, billingStatus, endsInDays, status, id]
    );

    // 3. Update the history
    const oldPlan = currentTenant.plan_tier;
    const oldBillingStatus = currentTenant.billing_status;
    const oldEndsInDays = Number(currentTenant.ends_in_days);
    const oldStatus = currentTenant.status;

    // Detect if we should open a new segment or modify the existing one
    const planChanged = oldPlan !== plan;
    const becomingInactive = status === "INACTIVE" && oldStatus !== "INACTIVE";
    const becomingActive = status === "ACTIVE" && oldStatus === "INACTIVE";
    const renewed = oldBillingStatus === "Collected" && billingStatus === "Pending";

    if (becomingInactive) {
      // Close active history record
      await connection.query(
        "UPDATE tenant_subscription_history SET end_date = CURRENT_TIMESTAMP WHERE tenant_id = ? AND end_date IS NULL",
        [id]
      );
    } else if (renewed || becomingActive) {
      // Close active history record (if exists)
      await connection.query(
        "UPDATE tenant_subscription_history SET end_date = CURRENT_TIMESTAMP WHERE tenant_id = ? AND end_date IS NULL",
        [id]
      );
      // Create new history record
      await connection.query(
        `INSERT INTO tenant_subscription_history (tenant_id, plan_tier, billing_status, start_date)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, plan, billingStatus]
      );
    } else {
      // Just update current active history record if it exists
      const [activeRows] = await connection.query(
        "SELECT id FROM tenant_subscription_history WHERE tenant_id = ? AND end_date IS NULL LIMIT 1",
        [id]
      );
      if (activeRows.length > 0) {
        await connection.query(
          "UPDATE tenant_subscription_history SET plan_tier = ?, billing_status = ? WHERE id = ?",
          [plan, billingStatus, activeRows[0].id]
        );
      } else {
        // If somehow no active record exists, create one
        await connection.query(
          `INSERT INTO tenant_subscription_history (tenant_id, plan_tier, billing_status, start_date)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [id, plan, billingStatus]
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: "Subscription updated successfully." });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/**
 * Computes platform-wide totals (Total Tenants, Sales volume, Eggs aggregated) for Super Admin reports.
 * GET /api/tenants/platform-stats
 */
exports.getPlatformStats = async (req, res) => {
  try {
    const [[{ totalTenants }]] = await db.query("SELECT COUNT(*) AS totalTenants FROM tenants");
    const [[{ totalUsers }]] = await db.query("SELECT COUNT(*) AS totalUsers FROM users");
    const [[{ totalSales, totalSalesPaid }]] = await db.query("SELECT COALESCE(SUM(total), 0) AS totalSales, COALESCE(SUM(paid), 0) AS totalSalesPaid FROM sales");
    const [[{ totalPurchases, totalPurchasesPaid }]] = await db.query("SELECT COALESCE(SUM(cost), 0) AS totalPurchases, COALESCE(SUM(paid), 0) AS totalPurchasesPaid FROM purchases");
    const [[{ totalEggsCollected }]] = await db.query("SELECT COALESCE(SUM(qty), 0) AS totalEggsCollected FROM egg_collections");
    
    let totalDisposedQty = 0;
    try {
      const [[resDisposed]] = await db.query("SELECT COALESCE(SUM(quantity), 0) AS totalDisposedQty FROM inventory_disposals");
      totalDisposedQty = resDisposed.totalDisposedQty;
    } catch (e) {
      console.log("inventory_disposals table query failed, skipping", e);
    }
    
    const [[{ totalStaff }]] = await db.query("SELECT COUNT(*) AS totalStaff FROM staff");
    const [[{ totalSheds }]] = await db.query("SELECT COUNT(*) AS totalSheds FROM sheds");

    res.json({
      totalTenants,
      totalUsers,
      totalSales: Number(totalSales),
      totalSalesPaid: Number(totalSalesPaid),
      totalPurchases: Number(totalPurchases),
      totalPurchasesPaid: Number(totalPurchasesPaid),
      totalEggsCollected: Number(totalEggsCollected),
      totalDisposedQty: Number(totalDisposedQty),
      totalStaff,
      totalSheds
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Modifies specific tenant details and optionally resets tenant admin password.
 * PUT /api/tenants/:id
 */
exports.updateTenant = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const {
      tenant_code,
      farm_name,
      owner_name,
      phone,
      email,
      admin_name,
      admin_email,
      admin_phone,
      admin_password
    } = req.body;

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Update tenants table
    await connection.query(
      `UPDATE tenants
       SET tenant_code = ?, farm_name = ?, owner_name = ?, phone = ?, email = ?
       WHERE id = ?`,
      [tenant_code, farm_name, owner_name, phone || null, email || null, id]
    );

    // 2. Find and update the tenant admin user
    const [admins] = await connection.query(
      "SELECT id FROM users WHERE tenant_id = ? AND role = 'ADMIN' LIMIT 1",
      [id]
    );

    if (admins.length > 0) {
      const adminId = admins[0].id;
      const userUpdates = [];
      const userParams = [];

      if (admin_name !== undefined) {
        userUpdates.push("full_name = ?");
        userParams.push(admin_name);
      }
      if (admin_email !== undefined) {
        userUpdates.push("email = ?");
        userParams.push(admin_email);
      }
      if (admin_phone !== undefined) {
        userUpdates.push("phone = ?");
        userParams.push(admin_phone);
      }
      if (admin_password) {
        const hash = await bcrypt.hash(admin_password, 10);
        userUpdates.push("password_hash = ?");
        userParams.push(hash);
        userUpdates.push("plain_password = ?");
        userParams.push(admin_password);
      }

      if (userUpdates.length > 0) {
        userParams.push(adminId);
        await connection.query(
          `UPDATE users SET ${userUpdates.join(", ")} WHERE id = ?`,
          userParams
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: "Tenant details updated successfully." });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};


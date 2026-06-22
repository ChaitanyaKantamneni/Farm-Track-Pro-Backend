const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const router = express.Router();

console.log("✅ Auth Routes Loaded");

/**
 * Health check test route.
 * GET /api/auth/test
 */
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Auth Route Working"
  });
});

/**
 * Log in a user (Super Admin, Tenant Admin, or Manager).
 * POST /api/auth/login
 * Performs credential checking, checks tenant subscription status, and signs JWT.
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and Password are required"
      });
    }

    const [users] = await db.query(
      `
      SELECT *
      FROM users
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid Email or Password"
      });
    }

    const user = users[0];

    let farmName = null;
    let logo = null;
    let planName = 'Pro';
    let endsInDays = 30;
    let status = 'ACTIVE';
    let billingStatus = 'Collected';
    if (user.tenant_id) {
      const [tenants] = await db.query(
        `
        SELECT status, farm_name, logo, plan_tier, 
               GREATEST(0, ends_in_days - TIMESTAMPDIFF(DAY, subscription_updated_at, CURRENT_TIMESTAMP)) AS ends_in_days, 
               billing_status
        FROM tenants
        WHERE id = ?
        LIMIT 1
        `,
        [user.tenant_id]
      );
      if (tenants.length > 0) {
        const tenant = tenants[0];
        if (tenant.status === "INACTIVE" || Number(tenant.ends_in_days) <= 0 || tenant.billing_status === "Pending") {
          const isPending = tenant.billing_status === "Pending";
          return res.status(403).json({
            success: false,
            message: isPending 
              ? "Your subscription payment is pending verification by the administrator. Access will be unlocked shortly."
              : "Your farm subscription has expired or is inactive. Please select a plan to renew.",
            isExpired: !isPending,
            isPending: isPending,
            tenantId: user.tenant_id
          });
        }
        farmName = tenant.farm_name;
        logo = tenant.logo;
        planName = tenant.plan_tier || 'Pro';
        endsInDays = tenant.ends_in_days !== undefined ? Number(tenant.ends_in_days) : 30;
        status = tenant.status || 'ACTIVE';
        billingStatus = tenant.billing_status || 'Collected';
      }
    }

    const isPasswordValid =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid Email or Password"
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d"
      }
    );

    res.json({
      success: true,
      message: "Login Successful",
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        tenantId: user.tenant_id,
        farmName,
        logo,
        planName,
        endsInDays,
        status,
        billingStatus
      }
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
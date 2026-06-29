const express = require("express");

const router = express.Router();

const {
  createTenant,
  getTenants,
  updateTenant,
  updateTenantLogo,
  updateTenantSubscription,
  getPlatformStats
} = require("../controllers/tenantController");

// POST /api/tenants - Creates a new tenant (Super Admin only validation in controller)
router.post("/", createTenant);

// GET /api/tenants - Lists all registered tenant instances
router.get("/", getTenants);

// PUT /api/tenants/:id - Modifies specific tenant details and resets admin password
router.put("/:id", updateTenant);

// GET /api/tenants/platform-stats - Aggregates analytical reports and metrics for billing
router.get("/platform-stats", getPlatformStats);

// PUT /api/tenants/:id/logo - Modifies specific tenant brand image
router.put("/:id/logo", updateTenantLogo);

// PUT /api/tenants/:id/subscription - Upgrades/Renews subscription plans or changes active status
router.put("/:id/subscription", updateTenantSubscription);

module.exports = router;
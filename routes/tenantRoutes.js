const express = require("express");

const router = express.Router();

const {
  createTenant,
  getTenants
}
=
require(
  "../controllers/tenantController"
);

router.post(
  "/",
  createTenant
);

router.get(
  "/",
  getTenants
);

module.exports = router;
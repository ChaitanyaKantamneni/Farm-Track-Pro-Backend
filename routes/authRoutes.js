const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const router = express.Router();

console.log("✅ Auth Routes Loaded");

/*
=================================
TEST ROUTE
GET /api/auth/test
=================================
*/
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Auth Route Working"
  });
});

/*
=================================
LOGIN
POST /api/auth/login
=================================
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
        tenantId: user.tenant_id
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
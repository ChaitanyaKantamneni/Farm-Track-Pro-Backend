const bcrypt = require("bcrypt");
const db = require("../config/db");

exports.createTenant = async (req, res) => {

  let connection;

  try {

    const {
      tenant_code,
      farm_name,
      owner_name,
      phone,
      email,

      admin_name,
      admin_email,
      admin_phone
    } = req.body;

    connection = await db.getConnection();

    await connection.beginTransaction();

    const [tenantResult] =
      await connection.query(
        `
        INSERT INTO tenants
        (
          tenant_code,
          farm_name,
          owner_name,
          phone,
          email
        )
        VALUES (?,?,?,?,?)
        `,
        [
          tenant_code,
          farm_name,
          owner_name,
          phone,
          email
        ]
      );

    const tenantId =
      tenantResult.insertId;

    const defaultPassword =
      "Farm@123";

    const passwordHash =
      await bcrypt.hash(
        defaultPassword,
        10
      );

    await connection.query(
      `
      INSERT INTO users
      (
        tenant_id,
        full_name,
        email,
        phone,
        password_hash,
        role
      )
      VALUES (?,?,?,?,?,?)
      `,
      [
        tenantId,
        admin_name,
        admin_email,
        admin_phone,
        passwordHash,
        "ADMIN"
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
      message:
        "Tenant Created Successfully",

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

exports.getTenants =
async (req, res) => {

  try {

    const [rows] =
      await db.query(`
        SELECT *
        FROM tenants
        ORDER BY id DESC
      `);

    res.json(rows);

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

};

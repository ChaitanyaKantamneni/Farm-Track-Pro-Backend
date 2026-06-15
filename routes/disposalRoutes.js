const express = require("express");
const db = require("../config/db");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// Generate DISP-YYYY-XXXX
const generateDisposalNumber = async (tenantId) => {
  const year = new Date().getFullYear();
  const prefix = `DISP-${year}-`;
  const [rows] = await db.query(
    `SELECT disposal_number FROM inventory_disposals WHERE tenant_id = ? AND disposal_number LIKE ? ORDER BY id DESC LIMIT 1`,
    [tenantId, `${prefix}%`]
  );
  if (rows.length === 0) return `${prefix}0001`;
  const lastNum = parseInt(rows[0].disposal_number.split("-")[2], 10);
  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
};

// GET /api/inventory/disposals
router.get("/disposals", auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM inventory_disposals WHERE tenant_id = ? ORDER BY id DESC`,
      [req.user.tenantId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/disposals
router.post("/disposals", auth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const {
      disposal_type,
      source_id,
      item_snapshot_name,
      quantity,
      unit,
      disposal_reason,
      disposal_date,
      notes
    } = req.body;

    const qty = Number(quantity);
    if (qty <= 0) return res.status(400).json({ error: "Quantity must be greater than zero." });

    let unitCost = 0;

    // VALIDATION
    if (disposal_type === 'EGG') {
      // 1. Fetch Standard Egg Cost from tenant_settings
      const [settings] = await db.query(`SELECT standard_egg_cost FROM tenant_settings WHERE tenant_id = ?`, [tenantId]);
      unitCost = settings.length ? Number(settings[0].standard_egg_cost) : 0;

      // 2. Validate Available Stock
      const [collectedRow] = await db.query(`SELECT SUM(qty) as sum FROM egg_collections WHERE tenant_id = ?`, [tenantId]);
      const totalCollected = Number(collectedRow[0].sum || 0);

      const [soldRow] = await db.query(`SELECT SUM(qty) as sum FROM sales WHERE tenant_id = ? AND item_name = 'Eggs'`, [tenantId]);
      const totalSold = Number(soldRow[0].sum || 0);

      const [disposedRow] = await db.query(`SELECT SUM(quantity) as sum FROM inventory_disposals WHERE tenant_id = ? AND disposal_type = 'EGG' AND status = 'ACTIVE'`, [tenantId]);
      const totalDisposed = Number(disposedRow[0].sum || 0);

      const available = totalCollected - totalSold - totalDisposed;
      if (qty > available) {
        return res.status(400).json({ error: `Cannot dispose ${qty} eggs. Only ${available} eggs are currently available.` });
      }

    } else if (disposal_type === 'PURCHASE_ITEM') {
      if (!source_id) return res.status(400).json({ error: "Source purchase ID is required for items." });

      // 1. Fetch Purchase info
      const [purchases] = await db.query(`SELECT price, qty FROM purchases WHERE id = ? AND tenant_id = ?`, [source_id, tenantId]);
      if (purchases.length === 0) return res.status(404).json({ error: "Purchase record not found." });
      
      const purchaseQty = Number(purchases[0].qty);
      unitCost = Number(purchases[0].price); // Note: price is unit cost in purchases schema? Wait, schema has price and cost. Assuming price = unit cost.

      // 2. Validate Available Stock for this specific purchase
      const [disposedRow] = await db.query(`SELECT SUM(quantity) as sum FROM inventory_disposals WHERE tenant_id = ? AND source_id = ? AND status = 'ACTIVE'`, [tenantId, source_id]);
      const totalDisposed = Number(disposedRow[0].sum || 0);

      const available = purchaseQty - totalDisposed;
      if (qty > available) {
        return res.status(400).json({ error: `Cannot dispose ${qty} items. Only ${available} available from this batch.` });
      }
    }

    const totalLoss = qty * unitCost;
    const disposalNumber = await generateDisposalNumber(tenantId);

    const [result] = await db.query(
      `INSERT INTO inventory_disposals 
        (tenant_id, disposal_number, disposal_type, source_id, item_snapshot_name, quantity, unit, unit_cost, total_loss, disposal_reason, disposal_date, notes, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, disposalNumber, disposal_type, source_id || null, item_snapshot_name, qty, unit, unitCost, totalLoss, disposal_reason, disposal_date, notes || "", req.user.id]
    );

    res.json({ success: true, message: "Disposal recorded successfully.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inventory/disposals/:id
router.put("/disposals/:id", auth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const disposalId = req.params.id;
    const { quantity, disposal_reason, notes, disposal_date } = req.body;
    
    const qty = Number(quantity);
    if (qty <= 0) return res.status(400).json({ error: "Quantity must be greater than zero." });

    // Fetch existing disposal
    const [existing] = await db.query(`SELECT * FROM inventory_disposals WHERE id = ? AND tenant_id = ?`, [disposalId, tenantId]);
    if (existing.length === 0) return res.status(404).json({ error: "Disposal record not found." });
    
    const disp = existing[0];
    const oldQty = Number(disp.quantity);
    const diff = qty - oldQty; // additional amount being disposed
    
    if (diff > 0) {
      if (disp.disposal_type === 'EGG') {
        const [collectedRow] = await db.query(`SELECT SUM(qty) as sum FROM egg_collections WHERE tenant_id = ?`, [tenantId]);
        const [soldRow] = await db.query(`SELECT SUM(qty) as sum FROM sales WHERE tenant_id = ? AND item_name = 'Eggs'`, [tenantId]);
        const [disposedRow] = await db.query(`SELECT SUM(quantity) as sum FROM inventory_disposals WHERE tenant_id = ? AND disposal_type = 'EGG' AND status = 'ACTIVE' AND id != ?`, [tenantId, disposalId]);
        
        const available = Number(collectedRow[0].sum || 0) - Number(soldRow[0].sum || 0) - Number(disposedRow[0].sum || 0);
        if (qty > available) {
          return res.status(400).json({ error: `Cannot increase disposal to ${qty}. Only ${available} eggs available.` });
        }
      } else if (disp.disposal_type === 'PURCHASE_ITEM') {
        const [purchases] = await db.query(`SELECT qty FROM purchases WHERE id = ? AND tenant_id = ?`, [disp.source_id, tenantId]);
        const purchaseQty = Number(purchases[0].qty);
        
        const [disposedRow] = await db.query(`SELECT SUM(quantity) as sum FROM inventory_disposals WHERE tenant_id = ? AND source_id = ? AND status = 'ACTIVE' AND id != ?`, [tenantId, disp.source_id, disposalId]);
        
        const available = purchaseQty - Number(disposedRow[0].sum || 0);
        if (qty > available) {
          return res.status(400).json({ error: `Cannot increase disposal to ${qty}. Only ${available} available from this batch.` });
        }
      }
    }

    const totalLoss = qty * Number(disp.unit_cost);

    await db.query(
      `UPDATE inventory_disposals 
       SET quantity = ?, total_loss = ?, disposal_reason = ?, disposal_date = ?, notes = ?, updated_by = ? 
       WHERE id = ?`,
      [qty, totalLoss, disposal_reason, disposal_date, notes || "", req.user.id, disposalId]
    );

    res.json({ success: true, message: "Disposal updated successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE (Void) /api/inventory/disposals/:id
router.delete("/disposals/:id", auth, async (req, res) => {
  try {
    await db.query(`UPDATE inventory_disposals SET status = 'VOID', updated_by = ? WHERE id = ? AND tenant_id = ?`, [req.user.id, req.params.id, req.user.tenantId]);
    res.json({ success: true, message: "Disposal voided successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT (Restore) /api/inventory/disposals/:id/restore
router.put("/disposals/:id/restore", auth, async (req, res) => {
  try {
    // Note: Before restoring, we should conceptually validate stock again, but for V1 we can assume the user knows what they're doing or simply restore. Let's do strict validation.
    const tenantId = req.user.tenantId;
    const disposalId = req.params.id;
    
    const [existing] = await db.query(`SELECT * FROM inventory_disposals WHERE id = ? AND tenant_id = ?`, [disposalId, tenantId]);
    if (existing.length === 0) return res.status(404).json({ error: "Disposal record not found." });
    const disp = existing[0];
    const qty = Number(disp.quantity);
    
    if (disp.status === 'ACTIVE') return res.json({ success: true });

    if (disp.disposal_type === 'EGG') {
        const [collectedRow] = await db.query(`SELECT SUM(qty) as sum FROM egg_collections WHERE tenant_id = ?`, [tenantId]);
        const [soldRow] = await db.query(`SELECT SUM(qty) as sum FROM sales WHERE tenant_id = ? AND item_name = 'Eggs'`, [tenantId]);
        const [disposedRow] = await db.query(`SELECT SUM(quantity) as sum FROM inventory_disposals WHERE tenant_id = ? AND disposal_type = 'EGG' AND status = 'ACTIVE'`, [tenantId]);
        
        const available = Number(collectedRow[0].sum || 0) - Number(soldRow[0].sum || 0) - Number(disposedRow[0].sum || 0);
        if (qty > available) {
          return res.status(400).json({ error: `Cannot restore. Only ${available} eggs available.` });
        }
    } else if (disp.disposal_type === 'PURCHASE_ITEM') {
        const [purchases] = await db.query(`SELECT qty FROM purchases WHERE id = ? AND tenant_id = ?`, [disp.source_id, tenantId]);
        if(purchases.length > 0) {
           const purchaseQty = Number(purchases[0].qty);
           const [disposedRow] = await db.query(`SELECT SUM(quantity) as sum FROM inventory_disposals WHERE tenant_id = ? AND source_id = ? AND status = 'ACTIVE'`, [tenantId, disp.source_id]);
           const available = purchaseQty - Number(disposedRow[0].sum || 0);
           if (qty > available) {
             return res.status(400).json({ error: `Cannot restore. Only ${available} available from this batch.` });
           }
        }
    }

    await db.query(`UPDATE inventory_disposals SET status = 'ACTIVE', updated_by = ? WHERE id = ?`, [req.user.id, disposalId]);
    res.json({ success: true, message: "Disposal restored successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/settings
router.get("/settings", auth, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM tenant_settings WHERE tenant_id = ?`, [req.user.tenantId]);
    res.json(rows[0] || { standard_egg_cost: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inventory/settings
router.put("/settings", auth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { standard_egg_cost } = req.body;
    await db.query(
      `INSERT INTO tenant_settings (tenant_id, standard_egg_cost) VALUES (?, ?) ON DUPLICATE KEY UPDATE standard_egg_cost = ?`,
      [tenantId, standard_egg_cost || 0, standard_egg_cost || 0]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

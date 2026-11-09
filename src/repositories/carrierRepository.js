const db = require('../db/pool');

async function findAll() {
  const { rows } = await db.query('SELECT * FROM carriers ORDER BY id');
  return rows;
}

async function updateThresholds(id, { maxDwellHours, staleAfterHours, costTolerancePct }) {
  const { rows } = await db.query(
    `UPDATE carriers SET
       max_dwell_hours = COALESCE($2, max_dwell_hours),
       stale_after_hours = COALESCE($3, stale_after_hours),
       cost_tolerance_pct = COALESCE($4, cost_tolerance_pct)
     WHERE id = $1 RETURNING *`,
    [id, maxDwellHours ?? null, staleAfterHours ?? null, costTolerancePct ?? null]);
  return rows[0] || null;
}

module.exports = { findAll, updateThresholds };

const db = require('../db/pool');

async function findAll({ status, type, severity, limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  for (const [col, val] of [['a.status', status], ['a.type', type], ['a.severity', severity]]) {
    if (val) {
      params.push(val);
      where.push(`${col} = $${params.length}`);
    }
  }
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT a.*, o.tracking_no, c.name AS customer_name, c.tier AS customer_tier
     FROM alerts a
     JOIN orders o ON o.id = a.order_id
     JOIN customers c ON c.id = o.customer_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.detected_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return rows;
}

async function findByOrder(orderId) {
  const { rows } = await db.query('SELECT * FROM alerts WHERE order_id = $1 ORDER BY detected_at', [orderId]);
  return rows;
}

async function updateStatus(id, status) {
  const { rows } = await db.query(
    `UPDATE alerts
     SET status = $2,
         acknowledged_at = CASE WHEN $2 = 'acknowledged' THEN now() ELSE acknowledged_at END
     WHERE id = $1 RETURNING *`, [id, status]);
  return rows[0] || null;
}

async function countsByStatus() {
  const { rows } = await db.query(
    `SELECT type, severity, status, count(*)::int AS count FROM alerts GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);
  return rows;
}

module.exports = { findAll, findByOrder, updateStatus, countsByStatus };

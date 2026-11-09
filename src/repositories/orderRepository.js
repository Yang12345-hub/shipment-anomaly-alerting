// Data access for orders. Only SQL lives here; no business rules.
const db = require('../db/pool');

async function findAll({ status, carrierId, customerId, atRisk, limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  if (carrierId) {
    params.push(carrierId);
    where.push(`o.carrier_id = $${params.length}`);
  }
  if (customerId) {
    params.push(customerId);
    where.push(`o.customer_id = $${params.length}`);
  }
  if (atRisk) {
    where.push(`EXISTS (SELECT 1 FROM alerts a WHERE a.order_id = o.id AND a.status <> 'resolved')`);
  }
  params.push(limit, offset);
  const sql = `
    SELECT o.*, c.name AS customer_name, c.tier AS customer_tier, ca.code AS carrier_code
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN carriers ca ON ca.id = o.carrier_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY o.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const { rows } = await db.query(sql, params);
  return rows;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT o.*, c.name AS customer_name, c.tier AS customer_tier, ca.code AS carrier_code
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     JOIN carriers ca ON ca.id = o.carrier_id
     WHERE o.id = $1`, [id]);
  return rows[0] || null;
}

async function create({ trackingNo, customerId, carrierId, origin, destination, weightKg }) {
  const { rows } = await db.query(
    `INSERT INTO orders (tracking_no, customer_id, carrier_id, origin, destination, weight_kg)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [trackingNo, customerId, carrierId, origin, destination, weightKg]);
  return rows[0];
}

async function update(id, fields) {
  const allowed = { destination: 'destination', weightKg: 'weight_kg', status: 'status' };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      params.push(fields[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return findById(id);
  params.push(id);
  const { rows } = await db.query(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  return rows[0] || null;
}

async function markDelivered(id, deliveredAt) {
  await db.query(`UPDATE orders SET status = 'delivered', delivered_at = $2 WHERE id = $1`, [id, deliveredAt]);
}

async function markInTransit(id) {
  await db.query(`UPDATE orders SET status = 'in_transit' WHERE id = $1 AND status = 'created'`, [id]);
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM orders WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { findAll, findById, create, update, markDelivered, markInTransit, remove };

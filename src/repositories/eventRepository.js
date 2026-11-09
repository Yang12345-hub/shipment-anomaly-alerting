const db = require('../db/pool');

async function findByOrder(orderId) {
  const { rows } = await db.query(
    'SELECT * FROM shipment_events WHERE order_id = $1 ORDER BY occurred_at', [orderId]);
  return rows;
}

async function create({ orderId, node, location, occurredAt }) {
  const { rows } = await db.query(
    `INSERT INTO shipment_events (order_id, node, location, occurred_at)
     VALUES ($1, $2, $3, $4) RETURNING *`, [orderId, node, location, occurredAt]);
  return rows[0];
}

module.exports = { findByOrder, create };

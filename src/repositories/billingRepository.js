const db = require('../db/pool');

async function findByOrder(orderId) {
  const { rows } = await db.query('SELECT * FROM billing_records WHERE order_id = $1', [orderId]);
  return rows[0] || null;
}

module.exports = { findByOrder };

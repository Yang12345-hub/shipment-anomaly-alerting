const db = require('../db/pool');

async function findById(id) {
  const { rows } = await db.query('SELECT * FROM customers WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { findById };

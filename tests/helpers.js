const db = require('../src/db/pool');
const migrate = require('../scripts/migrate');

const HOUR = 3600 * 1000;
const NOW = new Date('2026-11-01T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * HOUR);

async function resetDb() {
  await migrate();
  await db.query(`INSERT INTO carriers (code, name, rate_per_kg, max_dwell_hours, stale_after_hours, cost_tolerance_pct)
                  VALUES ('TST', 'Test Carrier', 4.0, 24, 36, 10)`);
  await db.query(`INSERT INTO customers (name, contact_email, tier, region) VALUES
                  ('Standard Co', 'std@example.com', 'standard', 'South China'),
                  ('Priority Co', 'vip@example.com', 'priority', 'East China')`);
}

let counter = 0;
async function makeOrder({ customerId = 1, createdHoursAgo = 100, delivered = false } = {}) {
  counter += 1;
  const { rows } = await db.query(
    `INSERT INTO orders (tracking_no, customer_id, carrier_id, origin, destination, weight_kg, status, created_at, delivered_at)
     VALUES ($1, $2, 1, 'Guangzhou', 'Shanghai', 10, $3, $4, $5) RETURNING id`,
    [`T${counter}`, customerId, delivered ? 'delivered' : 'in_transit', hoursAgo(createdHoursAgo),
      delivered ? hoursAgo(1) : null]);
  return rows[0].id;
}

async function addEvent(orderId, node, hAgo) {
  await db.query(
    `INSERT INTO shipment_events (order_id, node, location, occurred_at) VALUES ($1, $2, 'Somewhere', $3)`,
    [orderId, node, hoursAgo(hAgo)]);
}

async function addBilling(orderId, expected, billed, hAgo = 2) {
  await db.query(
    'INSERT INTO billing_records (order_id, expected_cost, billed_cost, billed_at) VALUES ($1, $2, $3, $4)',
    [orderId, expected, billed, hoursAgo(hAgo)]);
}

module.exports = { db, resetDb, makeOrder, addEvent, addBilling, NOW, hoursAgo };

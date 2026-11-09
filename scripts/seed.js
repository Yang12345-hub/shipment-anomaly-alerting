// Generates 3 weeks of synthetic shipment data and injects ~2% anomalies on purpose.
// Everything here is fake (Faker + a fixed random seed), so runs are reproducible.
//
// Usage: npm run seed            (simulation window ends "now")
//        SIM_END=2026-11-01T00:00:00Z npm run seed
const { faker } = require('@faker-js/faker');
const db = require('../src/db/pool');
const migrate = require('./migrate');
const config = require('../src/config');

faker.seed(42);

const HOUR = 3600 * 1000;
const DAYS = 21;
const NUM_CUSTOMERS = 200;
const NUM_ORDERS = 8000;
const PRIORITY_SHARE = 0.15;
const ANOMALIES = { dwell_sla_breach: 70, stale_order: 55, cost_deviation: 45 }; // 170 total, ~2.1%

// Fictional carriers, each with its own thresholds
const CARRIERS = [
  { code: 'SWX', name: 'Swiftline Express',      rate: 4.2, dwell: 24, stale: 36, tol: 10 },
  { code: 'RWF', name: 'Redwood Freight',        rate: 3.6, dwell: 30, stale: 42, tol: 12 },
  { code: 'PAL', name: 'Pacific Arc Logistics',  rate: 5.0, dwell: 24, stale: 36, tol: 8 },
  { code: 'BHC', name: 'Blue Harbor Cargo',      rate: 3.2, dwell: 36, stale: 48, tol: 15 },
  { code: 'GPP', name: 'Granite Peak Parcel',    rate: 3.9, dwell: 30, stale: 48, tol: 10 },
];
const ORIGINS = ['Guangzhou', 'Shenzhen', 'Dongguan', 'Foshan'];
const DESTINATIONS = ['Shanghai', 'Beijing', 'Chengdu', 'Wuhan', 'Hangzhou', 'Xiamen',
  'Los Angeles', 'Singapore', 'Kuala Lumpur', 'Bangkok'];
const HUBS = { origin_hub: ['Guangzhou Baiyun Hub', 'Shenzhen Bao\'an Hub'],
  transit_hub: ['Wuhan Central Hub', 'Changsha Transfer Hub', 'Hong Kong Gateway'] };
const REGIONS = ['South China', 'East China', 'North China', 'Southwest China', 'Southeast Asia', 'North America'];
const NODES = ['picked_up', 'origin_hub', 'transit_hub', 'destination_hub', 'out_for_delivery', 'delivered'];

const rand = (min, max) => faker.number.float({ min, max });
const pick = (arr) => faker.helpers.arrayElement(arr);

function floorTo15(d) {
  const ms = 15 * 60 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

const simEnd = floorTo15(process.env.SIM_END ? new Date(process.env.SIM_END) : new Date());
const simStart = new Date(simEnd.getTime() - DAYS * 24 * HOUR);

function locationFor(node, order) {
  if (node === 'picked_up') return order.origin;
  if (node === 'origin_hub' || node === 'transit_hub') return pick(HUBS[node]);
  if (node === 'destination_hub') return `${order.destination} Hub`;
  return order.destination;
}

// Build the full event timeline for one order. Normal gaps are 1-12h, well under
// every threshold (the strictest is 24h * 0.75 = 18h for priority customers).
function buildTimeline(order, anomaly, carrier, isPriority) {
  const events = [];
  const factor = isPriority ? config.priorityThresholdFactor : 1;
  let t = order.created_at.getTime() + rand(1, 6) * HOUR;
  let detectableAt = null;

  // anomalies happen at a hub, never at the very first or last step
  const anomalyNode = anomaly && anomaly !== 'cost_deviation'
    ? pick(['origin_hub', 'transit_hub', 'destination_hub']) : null;

  for (const node of NODES) {
    const location = locationFor(node, order);
    events.push({ node, location, at: t });

    if (node === anomalyNode && anomaly === 'dwell_sla_breach') {
      // Stuck at this hub but the carrier keeps re-scanning it every ~8h
      const stuckHours = carrier.dwell * rand(1.4, 2.5);
      detectableAt = t + carrier.dwell * factor * HOUR;
      for (let s = t + 8 * HOUR; s < t + stuckHours * HOUR; s += 8 * HOUR) {
        events.push({ node, location, at: s });
      }
      t += stuckHours * HOUR + rand(1, 4) * HOUR;
      continue;
    }
    if (node === anomalyNode && anomaly === 'stale_order') {
      // The carrier goes silent: no updates at all for a long time
      detectableAt = t + carrier.stale * factor * HOUR;
      t += carrier.stale * rand(1.5, 3) * HOUR;
      continue;
    }
    // occasional extra scan at the transit hub, still within normal limits
    if (node === 'transit_hub' && faker.datatype.boolean(0.3)) {
      events.push({ node, location, at: t + rand(2, 5) * HOUR });
      t += rand(6, 12) * HOUR;
      continue;
    }
    t += rand(2, 12) * HOUR;
  }
  return { events, detectableAt };
}

async function bulkInsert(table, columns, rows, returning = '') {
  if (rows.length === 0) return [];
  const out = [];
  const chunk = 1000;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const params = [];
    const values = part.map((row, r) => {
      const ph = row.map((v, c) => {
        params.push(v);
        return `$${r * row.length + c + 1}`;
      });
      return `(${ph.join(', ')})`;
    });
    const res = await db.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')} ${returning}`, params);
    out.push(...res.rows);
  }
  return out;
}

async function seed() {
  await migrate();

  const carriers = await bulkInsert('carriers',
    ['code', 'name', 'rate_per_kg', 'max_dwell_hours', 'stale_after_hours', 'cost_tolerance_pct'],
    CARRIERS.map((c) => [c.code, c.name, c.rate, c.dwell, c.stale, c.tol]), 'RETURNING id, code');
  const carrierById = new Map(carriers.map((row, i) => [row.id, CARRIERS[i]]));

  const customers = await bulkInsert('customers', ['name', 'contact_email', 'tier', 'region'],
    Array.from({ length: NUM_CUSTOMERS }, () => {
      const name = faker.company.name();
      return [name, faker.internet.email({ provider: 'example.com' }).toLowerCase(),
        faker.datatype.boolean(PRIORITY_SHARE) ? 'priority' : 'standard', pick(REGIONS)];
    }), 'RETURNING id, tier');
  const tierById = new Map(customers.map((c) => [c.id, c.tier]));

  // Orders, spread evenly over the 3-week window
  const orders = Array.from({ length: NUM_ORDERS }, (_, i) => ({
    tracking_no: `TRK${String(100000 + i)}`,
    customer_id: pick(customers).id,
    carrier_id: pick(carriers).id,
    origin: pick(ORIGINS),
    destination: pick(DESTINATIONS),
    weight_kg: Number(rand(0.5, 40).toFixed(2)),
    created_at: new Date(simStart.getTime() + rand(0, DAYS * 24 - 1) * HOUR),
  })).sort((a, b) => a.created_at - b.created_at);

  // Pick which orders get an anomaly. Only orders created early enough
  // (at least 6 days before the end) so every anomaly shows up inside the window.
  const eligible = orders.filter((o) => o.created_at.getTime() < simEnd.getTime() - 6 * 24 * HOUR);
  const shuffled = faker.helpers.shuffle(eligible);
  let k = 0;
  for (const [type, count] of Object.entries(ANOMALIES)) {
    for (let j = 0; j < count; j++) shuffled[k++].anomaly = type;
  }

  const eventRows = [];
  const billingRows = [];
  const injected = [];

  for (const o of orders) {
    const carrier = carrierById.get(o.carrier_id);
    const isPriority = tierById.get(o.customer_id) === 'priority';
    const { events, detectableAt } = buildTimeline(o, o.anomaly, carrier, isPriority);

    // Only keep what has "happened" by the end of the window
    const visible = events.filter((e) => e.at <= simEnd.getTime());
    const last = visible[visible.length - 1];
    if (!last) o.status = 'created';
    else if (last.node === 'delivered') {
      o.status = 'delivered';
      o.delivered_at = new Date(last.at);
    } else o.status = 'in_transit';
    o.events = visible;

    if (o.status === 'delivered') {
      const expected = Number((8 + o.weight_kg * carrier.rate).toFixed(2));
      let billed = expected * (1 + rand(-0.03, 0.03)); // normal: within +/-3%
      const billedAt = last.at + rand(6, 48) * HOUR;
      if (o.anomaly === 'cost_deviation') {
        billed = expected * (1 + rand(0.25, 0.6)); // overbilled by 25-60%
      }
      if (billedAt <= simEnd.getTime()) {
        o.billing = [expected, Number(billed.toFixed(2)), new Date(billedAt)];
        if (o.anomaly === 'cost_deviation') o.detectableAt = billedAt;
      }
    }
    if (o.anomaly && o.anomaly !== 'cost_deviation') o.detectableAt = detectableAt;
  }

  const inserted = await bulkInsert('orders',
    ['tracking_no', 'customer_id', 'carrier_id', 'origin', 'destination', 'weight_kg', 'status', 'created_at', 'delivered_at'],
    orders.map((o) => [o.tracking_no, o.customer_id, o.carrier_id, o.origin, o.destination,
      o.weight_kg, o.status, o.created_at, o.delivered_at || null]), 'RETURNING id');

  orders.forEach((o, i) => {
    o.id = inserted[i].id;
    for (const e of o.events) eventRows.push([o.id, e.node, e.location, new Date(e.at)]);
    if (o.billing) billingRows.push([o.id, ...o.billing]);
    if (o.anomaly && o.detectableAt && o.detectableAt <= simEnd.getTime()) {
      injected.push([o.id, o.anomaly, new Date(o.detectableAt)]);
    }
  });

  await bulkInsert('shipment_events', ['order_id', 'node', 'location', 'occurred_at'], eventRows);
  await bulkInsert('billing_records', ['order_id', 'expected_cost', 'billed_cost', 'billed_at'], billingRows);
  await bulkInsert('injected_anomalies', ['order_id', 'type', 'detectable_at'], injected);

  const byType = injected.reduce((acc, r) => ({ ...acc, [r[1]]: (acc[r[1]] || 0) + 1 }), {});
  console.log(`Simulation window: ${simStart.toISOString()} -> ${simEnd.toISOString()}`);
  console.log(`Carriers: ${carriers.length}, customers: ${customers.length} (${customers.filter((c) => c.tier === 'priority').length} priority)`);
  console.log(`Orders: ${orders.length}, events: ${eventRows.length}, billing records: ${billingRows.length}`);
  console.log(`Injected anomalies: ${injected.length} (${(injected.length / orders.length * 100).toFixed(1)}%)`, byType);
}

if (require.main === module) {
  seed()
    .then(() => db.pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = seed;

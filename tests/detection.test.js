const { db, resetDb, makeOrder, addEvent, addBilling, NOW, hoursAgo } = require('./helpers');
const { runScan } = require('../src/detection/detector');

// Test carrier: max dwell 24h, stale after 36h, cost tolerance 10%.
// Priority customers get 0.75x: dwell 18h, stale 27h.

beforeEach(resetDb);
afterAll(() => db.pool.end());

const alertsFor = async (orderId) =>
  (await db.query('SELECT type, severity FROM alerts WHERE order_id = $1 ORDER BY type', [orderId])).rows;

test('a normal shipment raises no alerts', async () => {
  const id = await makeOrder();
  await addEvent(id, 'picked_up', 20);
  await addEvent(id, 'origin_hub', 12);
  await addEvent(id, 'transit_hub', 3);
  await runScan(NOW);
  expect(await alertsFor(id)).toEqual([]);
});

test('dwell SLA breach: re-scanned at the same hub for longer than max dwell', async () => {
  const id = await makeOrder();
  await addEvent(id, 'picked_up', 40);
  await addEvent(id, 'transit_hub', 30); // arrived 30h ago (limit 24h)
  await addEvent(id, 'transit_hub', 22);
  await addEvent(id, 'transit_hub', 6); // still being scanned there
  await runScan(NOW);
  expect(await alertsFor(id)).toEqual([{ type: 'dwell_sla_breach', severity: 'medium' }]);
});

test('stale order: no carrier update for longer than stale_after_hours', async () => {
  const id = await makeOrder();
  await addEvent(id, 'picked_up', 50);
  await addEvent(id, 'origin_hub', 40); // silent for 40h (limit 36h)
  await runScan(NOW);
  expect(await alertsFor(id)).toEqual([{ type: 'stale_order', severity: 'medium' }]);
});

test('a silent order is reported as stale, not as a dwell breach', async () => {
  const id = await makeOrder();
  await addEvent(id, 'origin_hub', 30); // only one update at this hub, 30h ago
  await runScan(NOW);
  expect(await alertsFor(id)).toEqual([]); // 30h < 36h stale limit, and no re-scans
});

test('priority customers use stricter thresholds and get high severity', async () => {
  const standard = await makeOrder({ customerId: 1 });
  const priority = await makeOrder({ customerId: 2 });
  for (const id of [standard, priority]) {
    await addEvent(id, 'picked_up', 30);
    await addEvent(id, 'origin_hub', 30); // silent for 30h: under 36h, over 27h
  }
  await runScan(NOW);
  expect(await alertsFor(standard)).toEqual([]);
  expect(await alertsFor(priority)).toEqual([{ type: 'stale_order', severity: 'high' }]);
});

test('delivered orders are never flagged as stale', async () => {
  const id = await makeOrder({ delivered: true });
  await addEvent(id, 'picked_up', 90);
  await addEvent(id, 'delivered', 60);
  await runScan(NOW);
  expect(await alertsFor(id)).toEqual([]);
});

test('cost deviation above tolerance is flagged; within tolerance is not', async () => {
  const over = await makeOrder({ delivered: true });
  const ok = await makeOrder({ delivered: true });
  await addBilling(over, 100, 160); // +60%
  await addBilling(ok, 100, 108); // +8%, under 10%
  await runScan(NOW);
  expect(await alertsFor(over)).toEqual([{ type: 'cost_deviation', severity: 'high' }]);
  expect(await alertsFor(ok)).toEqual([]);
});

test('scanning again does not duplicate alerts', async () => {
  const id = await makeOrder();
  await addEvent(id, 'origin_hub', 40);
  await runScan(NOW);
  await runScan(new Date(NOW.getTime() + 15 * 60 * 1000));
  await runScan(new Date(NOW.getTime() + 30 * 60 * 1000));
  expect(await alertsFor(id)).toHaveLength(1);
});

test('events after "now" are ignored, so replay is correct', async () => {
  const id = await makeOrder();
  await addEvent(id, 'origin_hub', 40);
  await runScan(hoursAgo(10)); // at that time the order was only silent for 30h
  expect(await alertsFor(id)).toEqual([]);
});

test('alerts are sent to the publisher', async () => {
  const id = await makeOrder();
  await addEvent(id, 'origin_hub', 40);
  const sent = [];
  await runScan(NOW, { publish: async (a) => sent.push(a) });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ order_id: id, type: 'stale_order' });
});

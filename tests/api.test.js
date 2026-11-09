const request = require('supertest');
const createApp = require('../src/app');
const { db, resetDb, makeOrder } = require('./helpers');

const app = createApp(null);

beforeEach(resetDb);
afterAll(() => db.pool.end());

const newOrder = { trackingNo: 'TRK1', customerId: 1, carrierId: 1, origin: 'Guangzhou', destination: 'Shanghai', weightKg: 2.5 };

test('GET /health', async () => {
  await request(app).get('/health').expect(200, { status: 'ok' });
});

test('create, read, update and delete an order', async () => {
  const created = await request(app).post('/api/orders').send(newOrder).expect(201);
  expect(created.body).toMatchObject({ tracking_no: 'TRK1', status: 'created' });
  const id = created.body.id;

  const got = await request(app).get(`/api/orders/${id}`).expect(200);
  expect(got.body).toMatchObject({ customer_name: 'Standard Co', events: [], alerts: [] });

  const updated = await request(app).put(`/api/orders/${id}`).send({ destination: 'Beijing' }).expect(200);
  expect(updated.body.destination).toBe('Beijing');

  await request(app).delete(`/api/orders/${id}`).expect(204);
  await request(app).get(`/api/orders/${id}`).expect(404);
});

test('validation errors return 400', async () => {
  await request(app).post('/api/orders').send({ trackingNo: 'X' }).expect(400);
  await request(app).post('/api/orders').send({ ...newOrder, weightKg: -1 }).expect(400);
  await request(app).post('/api/orders').send({ ...newOrder, customerId: 999 }).expect(400); // FK
  await request(app).get('/api/orders/abc').expect(400);
});

test('duplicate tracking number returns 409', async () => {
  await request(app).post('/api/orders').send(newOrder).expect(201);
  await request(app).post('/api/orders').send(newOrder).expect(409);
});

test('carrier events move an order to in_transit and then delivered', async () => {
  const { body: order } = await request(app).post('/api/orders').send(newOrder);
  await request(app).post(`/api/orders/${order.id}/events`).send({ node: 'picked_up', location: 'Guangzhou' }).expect(201);
  expect((await request(app).get(`/api/orders/${order.id}`)).body.status).toBe('in_transit');
  await request(app).post(`/api/orders/${order.id}/events`).send({ node: 'teleported', location: 'x' }).expect(400);
  await request(app).post(`/api/orders/${order.id}/events`).send({ node: 'delivered', location: 'Shanghai' }).expect(201);
  const final = (await request(app).get(`/api/orders/${order.id}`)).body;
  expect(final.status).toBe('delivered');
  expect(final.events).toHaveLength(2);
});

test('scan endpoint creates alerts that can be listed and acknowledged', async () => {
  const id = await makeOrder({ createdHoursAgo: 500 });
  // relative to real time, since POST /api/scans uses "now"
  await db.query(`INSERT INTO shipment_events (order_id, node, location, occurred_at)
                  VALUES ($1, 'origin_hub', 'Hub', now() - interval '100 hours')`, [id]);
  const scan = await request(app).post('/api/scans').expect(200);
  expect(scan.body.created.stale_order).toBe(1);

  const { body: alerts } = await request(app).get('/api/alerts?status=open').expect(200);
  expect(alerts).toHaveLength(1);
  const acked = await request(app).put(`/api/alerts/${alerts[0].id}`).send({ status: 'acknowledged' }).expect(200);
  expect(acked.body.acknowledged_at).not.toBeNull();

  const { body: atRisk } = await request(app).get(`/api/customers/1/orders?atRisk=true`).expect(200);
  expect(atRisk.orders.map((o) => o.id)).toEqual([id]);
});

test('carrier thresholds can be updated', async () => {
  const { body } = await request(app).put('/api/carriers/1/thresholds').send({ maxDwellHours: 12 }).expect(200);
  expect(body.max_dwell_hours).toBe(12);
  await request(app).put('/api/carriers/1/thresholds').send({ maxDwellHours: 0 }).expect(400);
});

test('unknown route returns 404', async () => {
  await request(app).get('/api/nope').expect(404);
});

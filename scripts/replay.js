// Replays the 3-week simulation window: runs the detection scan every 15 simulated
// minutes, exactly like the cron job would have, then compares the alerts with the
// anomalies the seed script injected (table injected_anomalies).
//
// Usage: npm run replay
const db = require('../src/db/pool');
const { runScan } = require('../src/detection/detector');
const { CountingPublisher } = require('../src/alerts/publishers');

const STEP_MS = 15 * 60 * 1000;

async function replay() {
  const { rows: [range] } = await db.query(
    `SELECT min(created_at) AS start, max(occurred_at) AS last_event,
            (SELECT max(billed_at) FROM billing_records) AS last_bill
     FROM orders, LATERAL (SELECT max(occurred_at) AS occurred_at FROM shipment_events) e`);
  const start = new Date(Math.ceil(range.start.getTime() / STEP_MS) * STEP_MS);
  const lastData = Math.max(range.last_event.getTime(), range.last_bill.getTime());
  const end = new Date(Math.ceil(lastData / STEP_MS) * STEP_MS);

  await db.query('TRUNCATE alerts RESTART IDENTITY');
  const publisher = new CountingPublisher();
  const t0 = Date.now();
  let scans = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += STEP_MS) {
    await runScan(new Date(t), publisher);
    scans += 1;
  }
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const { rows: [orders] } = await db.query('SELECT count(*)::int AS n FROM orders');
  const { rows: byType } = await db.query(`
    SELECT i.type,
           count(*)::int AS injected,
           count(a.id)::int AS detected,
           round(avg(extract(epoch FROM a.detected_at - i.detectable_at) / 60)::numeric, 1) AS avg_lag_min,
           round(max(extract(epoch FROM a.detected_at - i.detectable_at) / 60)::numeric, 1) AS max_lag_min
    FROM injected_anomalies i
    LEFT JOIN LATERAL (
      SELECT * FROM alerts a WHERE a.order_id = i.order_id AND a.type = i.type
      ORDER BY a.detected_at LIMIT 1
    ) a ON true
    GROUP BY i.type ORDER BY i.type`);
  const { rows: [fp] } = await db.query(`
    SELECT count(*)::int AS n FROM alerts a
    WHERE NOT EXISTS (SELECT 1 FROM injected_anomalies i WHERE i.order_id = a.order_id AND i.type = a.type)`);
  const { rows: [flagged] } = await db.query('SELECT count(DISTINCT order_id)::int AS n FROM alerts');
  const { rows: severity } = await db.query(
    'SELECT severity, count(*)::int AS n FROM alerts GROUP BY 1 ORDER BY 1');

  const injected = byType.reduce((s, r) => s + r.injected, 0);
  const detected = byType.reduce((s, r) => s + r.detected, 0);
  const totalAlerts = publisher.count;

  console.log(`Replayed ${start.toISOString()} -> ${end.toISOString()}`);
  console.log(`${scans} scans (one per 15 simulated minutes) in ${seconds}s\n`);
  console.table(byType);
  console.log(`Orders monitored:      ${orders.n}`);
  console.log(`Orders flagged:        ${flagged.n} (${(flagged.n / orders.n * 100).toFixed(1)}% anomaly rate)`);
  console.log(`Alerts raised:         ${totalAlerts}`, Object.fromEntries(severity.map((r) => [r.severity, r.n])));
  console.log(`Recall:                ${detected}/${injected} injected anomalies detected (${(detected / injected * 100).toFixed(1)}%)`);
  console.log(`False positives:       ${fp.n}`);
  const avgLag = byType.reduce((s, r) => s + Number(r.avg_lag_min) * r.detected, 0) / detected;
  console.log(`Avg detection lag:     ${avgLag.toFixed(1)} min after the anomaly became detectable`);
}

replay()
  .then(() => db.pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

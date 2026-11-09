// Runs all three rules once for a given point in time and publishes any new alerts.
const db = require('../db/pool');
const config = require('../config');
const rules = require('./rules');

async function runScan(now = new Date(), publisher) {
  const created = {};
  const alerts = [];
  for (const [type, sql] of Object.entries(rules)) {
    // the cost rule does not use the priority factor ($2), so only pass what each rule needs
    const params = sql.includes('$2') ? [now, config.priorityThresholdFactor] : [now];
    const { rows } = await db.query(sql, params);
    created[type] = rows.length;
    alerts.push(...rows);
  }
  if (publisher) {
    for (const alert of alerts) {
      try {
        await publisher.publish(alert);
      } catch (err) {
        // A failed notification should not stop the scan; the alert is already saved
        console.error(`Failed to publish alert ${alert.id}:`, err.message);
      }
    }
  }
  return { scannedAt: now, created, total: alerts.length, alerts };
}

module.exports = { runScan };

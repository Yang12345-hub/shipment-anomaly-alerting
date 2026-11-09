// Runs the detection scan on a cron schedule (every 15 minutes by default).
const cron = require('node-cron');
const config = require('../config');
const { runScan } = require('./detector');

function startScheduler(publisher) {
  let running = false;
  const task = cron.schedule(config.scanCron, async () => {
    if (running) return; // skip if the previous scan is still going
    running = true;
    try {
      const result = await runScan(new Date(), publisher);
      console.log(`[scan] ${result.scannedAt.toISOString()} new alerts: ${JSON.stringify(result.created)}`);
    } catch (err) {
      console.error('[scan] failed:', err);
    } finally {
      running = false;
    }
  });
  console.log(`Detection scheduler started (${config.scanCron})`);
  return task;
}

module.exports = { startScheduler };

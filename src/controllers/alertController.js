const alertService = require('../services/alertService');
const { runScan } = require('../detection/detector');

module.exports = {
  list: async (req, res) => res.json(await alertService.listAlerts(req.query)),
  update: async (req, res) => res.json(await alertService.updateAlertStatus(req.params.id, req.body.status)),
  summary: async (req, res) => res.json(await alertService.summary()),
  // Trigger a detection scan right now instead of waiting for the next cron tick
  runScan: async (req, res) => {
    const result = await runScan(new Date(), req.app.locals.publisher);
    res.json({ scannedAt: result.scannedAt, created: result.created, total: result.total });
  },
};

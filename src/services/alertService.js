const alertRepo = require('../repositories/alertRepository');
const { HttpError } = require('../middleware/errors');
const { toId } = require('./orderService');

function listAlerts(query) {
  return alertRepo.findAll({
    status: query.status,
    type: query.type,
    severity: query.severity,
    limit: Math.min(Number(query.limit) || 50, 500),
    offset: Number(query.offset) || 0,
  });
}

async function updateAlertStatus(id, status) {
  if (!['open', 'acknowledged', 'resolved'].includes(status)) {
    throw new HttpError(400, 'status must be open, acknowledged, or resolved');
  }
  const alert = await alertRepo.updateStatus(toId(id), status);
  if (!alert) throw new HttpError(404, 'Alert not found');
  return alert;
}

module.exports = { listAlerts, updateAlertStatus, summary: alertRepo.countsByStatus };

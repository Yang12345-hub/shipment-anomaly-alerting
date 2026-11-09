const carrierRepo = require('../repositories/carrierRepository');
const { HttpError } = require('../middleware/errors');
const { toId } = require('./orderService');

async function updateThresholds(id, body) {
  for (const key of ['maxDwellHours', 'staleAfterHours', 'costTolerancePct']) {
    if (body[key] !== undefined && !(Number(body[key]) > 0)) {
      throw new HttpError(400, `${key} must be a positive number`);
    }
  }
  const carrier = await carrierRepo.updateThresholds(toId(id), body);
  if (!carrier) throw new HttpError(404, 'Carrier not found');
  return carrier;
}

module.exports = { listCarriers: carrierRepo.findAll, updateThresholds };

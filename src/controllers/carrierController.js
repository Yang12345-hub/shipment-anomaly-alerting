const carrierService = require('../services/carrierService');

module.exports = {
  list: async (req, res) => res.json(await carrierService.listCarriers()),
  updateThresholds: async (req, res) => res.json(await carrierService.updateThresholds(req.params.id, req.body)),
};

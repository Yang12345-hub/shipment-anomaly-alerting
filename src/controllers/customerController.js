const customerService = require('../services/customerService');

module.exports = {
  orders: async (req, res) => res.json(await customerService.getCustomerOrders(req.params.id, req.query)),
};

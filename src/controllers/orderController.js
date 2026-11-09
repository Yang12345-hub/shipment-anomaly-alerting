// Controllers only translate HTTP <-> service calls.
const orderService = require('../services/orderService');

module.exports = {
  list: async (req, res) => res.json(await orderService.listOrders(req.query)),
  get: async (req, res) => res.json(await orderService.getOrder(req.params.id)),
  create: async (req, res) => res.status(201).json(await orderService.createOrder(req.body)),
  update: async (req, res) => res.json(await orderService.updateOrder(req.params.id, req.body)),
  remove: async (req, res) => {
    await orderService.deleteOrder(req.params.id);
    res.status(204).end();
  },
  addEvent: async (req, res) => res.status(201).json(await orderService.addEvent(req.params.id, req.body)),
};

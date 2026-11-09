const customerRepo = require('../repositories/customerRepository');
const orderRepo = require('../repositories/orderRepository');
const { HttpError } = require('../middleware/errors');
const { toId } = require('./orderService');

async function getCustomerOrders(id, query) {
  const customer = await customerRepo.findById(toId(id));
  if (!customer) throw new HttpError(404, 'Customer not found');
  const orders = await orderRepo.findAll({
    customerId: customer.id,
    atRisk: query.atRisk === 'true',
    limit: Math.min(Number(query.limit) || 50, 500),
    offset: Number(query.offset) || 0,
  });
  return { customer, orders };
}

module.exports = { getCustomerOrders };

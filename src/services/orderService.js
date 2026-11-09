// Business rules for orders and carrier status updates.
const orderRepo = require('../repositories/orderRepository');
const eventRepo = require('../repositories/eventRepository');
const billingRepo = require('../repositories/billingRepository');
const alertRepo = require('../repositories/alertRepository');
const { HttpError } = require('../middleware/errors');

const NODES = ['picked_up', 'origin_hub', 'transit_hub', 'destination_hub', 'out_for_delivery', 'delivered'];
const STATUSES = ['created', 'in_transit', 'delivered', 'cancelled'];

function toId(value, name = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `${name} must be a positive integer`);
  return id;
}

function listOrders(query) {
  return orderRepo.findAll({
    status: query.status,
    carrierId: query.carrierId ? toId(query.carrierId, 'carrierId') : undefined,
    customerId: query.customerId ? toId(query.customerId, 'customerId') : undefined,
    atRisk: query.atRisk === 'true',
    limit: Math.min(Number(query.limit) || 50, 500),
    offset: Number(query.offset) || 0,
  });
}

async function getOrder(id) {
  const order = await orderRepo.findById(toId(id));
  if (!order) throw new HttpError(404, 'Order not found');
  const [events, billing, alerts] = await Promise.all([
    eventRepo.findByOrder(order.id), billingRepo.findByOrder(order.id), alertRepo.findByOrder(order.id)]);
  return { ...order, events, billing, alerts };
}

function createOrder(body) {
  const required = ['trackingNo', 'customerId', 'carrierId', 'origin', 'destination', 'weightKg'];
  const missing = required.filter((k) => body[k] === undefined || body[k] === '');
  if (missing.length) throw new HttpError(400, `Missing fields: ${missing.join(', ')}`);
  if (!(Number(body.weightKg) > 0)) throw new HttpError(400, 'weightKg must be greater than 0');
  return orderRepo.create(body);
}

async function updateOrder(id, body) {
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`);
  }
  const order = await orderRepo.update(toId(id), body);
  if (!order) throw new HttpError(404, 'Order not found');
  return order;
}

async function deleteOrder(id) {
  const removed = await orderRepo.remove(toId(id));
  if (!removed) throw new HttpError(404, 'Order not found');
}

// A carrier reports a new status for an order
async function addEvent(orderId, body) {
  const order = await orderRepo.findById(toId(orderId));
  if (!order) throw new HttpError(404, 'Order not found');
  if (!NODES.includes(body.node)) throw new HttpError(400, `node must be one of ${NODES.join(', ')}`);
  if (!body.location) throw new HttpError(400, 'location is required');
  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new HttpError(400, 'occurredAt must be a valid date');

  const event = await eventRepo.create({ orderId: order.id, node: body.node, location: body.location, occurredAt });
  if (body.node === 'delivered') await orderRepo.markDelivered(order.id, occurredAt);
  else await orderRepo.markInTransit(order.id);
  return event;
}

module.exports = { listOrders, getOrder, createOrder, updateOrder, deleteOrder, addEvent, toId };

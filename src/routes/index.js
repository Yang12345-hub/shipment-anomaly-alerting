const express = require('express');
const { asyncHandler: h } = require('../middleware/errors');
const orders = require('../controllers/orderController');
const alerts = require('../controllers/alertController');
const carriers = require('../controllers/carrierController');
const customers = require('../controllers/customerController');

const router = express.Router();

router.get('/orders', h(orders.list));
router.post('/orders', h(orders.create));
router.get('/orders/:id', h(orders.get));
router.put('/orders/:id', h(orders.update));
router.delete('/orders/:id', h(orders.remove));
router.post('/orders/:id/events', h(orders.addEvent));

router.get('/customers/:id/orders', h(customers.orders));

router.get('/carriers', h(carriers.list));
router.put('/carriers/:id/thresholds', h(carriers.updateThresholds));

router.get('/alerts', h(alerts.list));
router.get('/alerts/summary', h(alerts.summary));
router.put('/alerts/:id', h(alerts.update));
router.post('/scans', h(alerts.runScan));

module.exports = router;

// The three anomaly rules. Each one is a single INSERT ... SELECT, so the database
// does the filtering and we never load thousands of orders into Node.
//
// $1::timestamptz = "now" (real time in production, simulated time during replay)
// $2::numeric = threshold factor for priority customers (e.g. 0.75 = 25% stricter)
//
// "Active" orders = created by now and not delivered (as of now) and not cancelled.
// ON CONFLICT ... DO NOTHING uses the partial unique index uq_alerts_open, so an order
// that stays stuck does not get a new alert every 15 minutes.

const ACTIVE_ORDERS = (extraJoin = '') => `
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN carriers ca ON ca.id = o.carrier_id
  -- latest update for this order, as of now
  CROSS JOIN LATERAL (
    SELECT e.node, e.location, e.occurred_at AS last_at
    FROM shipment_events e
    WHERE e.order_id = o.id AND e.occurred_at <= $1::timestamptz
    ORDER BY e.occurred_at DESC
    LIMIT 1
  ) le
  ${extraJoin}
  WHERE o.created_at <= $1::timestamptz
    AND o.status <> 'cancelled'
    AND (o.delivered_at IS NULL OR o.delivered_at > $1::timestamptz)
    AND le.node <> 'delivered'`;

const THRESHOLD = (column) =>
  `make_interval(secs => ca.${column} * 3600 * CASE WHEN c.tier = 'priority' THEN $2::numeric ELSE 1 END)`;

const SEVERITY = `CASE WHEN c.tier = 'priority' THEN 'high' ELSE 'medium' END`;

const RETURNING = 'ON CONFLICT (order_id, type) WHERE status <> \'resolved\' DO NOTHING RETURNING *';

// Rule 1: stuck at one node. The carrier keeps re-scanning the package at the same
// hub (2+ updates there), but it has been there longer than the carrier's max dwell time.
const DWELL_SLA_BREACH = `
  INSERT INTO alerts (order_id, type, severity, message, details, detected_at)
  SELECT o.id, 'dwell_sla_breach', ${SEVERITY},
         format('Order %s has been at %s for %s h (limit %s h)', o.tracking_no, le.location,
                round(extract(epoch FROM ($1::timestamptz - fa.first_at)) / 3600, 1),
                round(ca.max_dwell_hours * CASE WHEN c.tier = 'priority' THEN $2::numeric ELSE 1 END, 1)),
         jsonb_build_object('node', le.node, 'location', le.location, 'arrived_at', fa.first_at,
                            'carrier', ca.code, 'customer_tier', c.tier),
         $1::timestamptz
  ${ACTIVE_ORDERS(`
  -- when the package first arrived at its current node, and how many updates since
  CROSS JOIN LATERAL (
    SELECT min(e.occurred_at) AS first_at, count(*) AS updates
    FROM shipment_events e
    WHERE e.order_id = o.id AND e.node = le.node AND e.occurred_at <= $1::timestamptz
  ) fa`)}
    AND fa.updates >= 2
    AND $1::timestamptz - fa.first_at > ${THRESHOLD('max_dwell_hours')}
    AND $1::timestamptz - le.last_at <= ${THRESHOLD('stale_after_hours')}
    AND NOT EXISTS (SELECT 1 FROM alerts a
                    WHERE a.order_id = o.id AND a.type = 'dwell_sla_breach' AND a.detected_at >= fa.first_at)
  ${RETURNING}`;

// Rule 2: stale / silent order. Not delivered, and the carrier has sent nothing at all
// for longer than its stale_after_hours.
const STALE_ORDER = `
  INSERT INTO alerts (order_id, type, severity, message, details, detected_at)
  SELECT o.id, 'stale_order', ${SEVERITY},
         format('Order %s has had no carrier update for %s h (last seen at %s)', o.tracking_no,
                round(extract(epoch FROM ($1::timestamptz - le.last_at)) / 3600, 1), le.location),
         jsonb_build_object('last_node', le.node, 'last_location', le.location, 'last_update_at', le.last_at,
                            'carrier', ca.code, 'customer_tier', c.tier),
         $1::timestamptz
  ${ACTIVE_ORDERS()}
    AND $1::timestamptz - le.last_at > ${THRESHOLD('stale_after_hours')}
    AND NOT EXISTS (SELECT 1 FROM alerts a
                    WHERE a.order_id = o.id AND a.type = 'stale_order' AND a.detected_at >= le.last_at)
  ${RETURNING}`;

// Rule 3: billing cost deviation. The carrier billed more than tolerance_pct away from
// the expected cost (weight * rate). Overbilling is a customer risk, so it is medium/high.
const COST_DEVIATION = `
  INSERT INTO alerts (order_id, type, severity, message, details, detected_at)
  SELECT o.id, 'cost_deviation',
         CASE WHEN c.tier = 'priority' OR b.deviation_pct >= 50 THEN 'high'
              WHEN b.deviation_pct < 0 THEN 'low'
              ELSE 'medium' END,
         format('Order %s was billed %s vs expected %s (%s%%, tolerance %s%%)', o.tracking_no,
                b.billed_cost, b.expected_cost, round(b.deviation_pct, 1), ca.cost_tolerance_pct),
         jsonb_build_object('expected_cost', b.expected_cost, 'billed_cost', b.billed_cost,
                            'deviation_pct', round(b.deviation_pct, 1), 'carrier', ca.code, 'customer_tier', c.tier),
         $1::timestamptz
  FROM (
    SELECT *, (billed_cost - expected_cost) / expected_cost * 100 AS deviation_pct
    FROM billing_records
    WHERE billed_at <= $1::timestamptz
  ) b
  JOIN orders o ON o.id = b.order_id
  JOIN customers c ON c.id = o.customer_id
  JOIN carriers ca ON ca.id = o.carrier_id
  WHERE abs(b.deviation_pct) > ca.cost_tolerance_pct
    AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.order_id = o.id AND a.type = 'cost_deviation')
  ${RETURNING}`;

module.exports = {
  dwell_sla_breach: DWELL_SLA_BREACH,
  stale_order: STALE_ORDER,
  cost_deviation: COST_DEVIATION,
};

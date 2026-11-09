-- Shipment tracking & anomaly alerting schema (PostgreSQL)
-- All data in this project is synthetic.

DROP TABLE IF EXISTS injected_anomalies, alerts, billing_records, shipment_events, orders, customers, carriers CASCADE;

-- Each carrier has its own thresholds for the detection rules.
CREATE TABLE carriers (
  id                  SERIAL PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  rate_per_kg         NUMERIC(10, 2) NOT NULL,          -- used to compute expected cost
  max_dwell_hours     INTEGER NOT NULL,                  -- rule 1: too long at one node
  stale_after_hours   INTEGER NOT NULL,                  -- rule 2: no update at all
  cost_tolerance_pct  NUMERIC(5, 2) NOT NULL             -- rule 3: billed vs expected
);

CREATE TABLE customers (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  tier           TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'priority')),
  region         TEXT NOT NULL
);

CREATE TABLE orders (
  id            SERIAL PRIMARY KEY,
  tracking_no   TEXT NOT NULL UNIQUE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  carrier_id    INTEGER NOT NULL REFERENCES carriers(id),
  origin        TEXT NOT NULL,
  destination   TEXT NOT NULL,
  weight_kg     NUMERIC(10, 2) NOT NULL CHECK (weight_kg > 0),
  status        TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN ('created', 'in_transit', 'delivered', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at  TIMESTAMPTZ
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_carrier ON orders(carrier_id);
CREATE INDEX idx_orders_created ON orders(created_at);

-- One row per status update a carrier sends us.
-- node = where the package is; a carrier may send several "scan" updates at the same node.
CREATE TABLE shipment_events (
  id           BIGSERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  node         TEXT NOT NULL
               CHECK (node IN ('picked_up', 'origin_hub', 'transit_hub', 'destination_hub',
                               'out_for_delivery', 'delivered')),
  location     TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_events_order_time ON shipment_events(order_id, occurred_at);

CREATE TABLE billing_records (
  id             SERIAL PRIMARY KEY,
  order_id       INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  expected_cost  NUMERIC(10, 2) NOT NULL,
  billed_cost    NUMERIC(10, 2) NOT NULL,
  billed_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE alerts (
  id               SERIAL PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('dwell_sla_breach', 'stale_order', 'cost_deviation')),
  severity         TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  message          TEXT NOT NULL,
  details          JSONB NOT NULL DEFAULT '{}',
  detected_at      TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_at  TIMESTAMPTZ
);
-- At most one unresolved alert per order per type, so a stuck order
-- does not create a new alert every 15 minutes.
CREATE UNIQUE INDEX uq_alerts_open ON alerts(order_id, type) WHERE status <> 'resolved';
CREATE INDEX idx_alerts_status ON alerts(status, severity);

-- Evaluation only: which anomalies the seed script injected on purpose,
-- and when each one became detectable. The detector never reads this table.
CREATE TABLE injected_anomalies (
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  detectable_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (order_id, type)
);

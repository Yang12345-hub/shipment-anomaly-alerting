# Shipment Tracking & Anomaly Alerting Platform

A backend that pulls status updates from multiple carriers into one place and automatically flags shipments that are going wrong, before they turn into customer complaints.

This is a re-implementation of a system I built during my software developer internship at a logistics company, using the same architecture and a public tech stack. **All data in this repo is synthetic** (generated with Faker and a fixed random seed). No company or customer data is used.

**Stack:** Node.js · Express · PostgreSQL · node-cron · AWS SNS · Docker Compose · Jest

## What it does

- **Layered REST API** (controller → service → repository) for orders, carrier status updates, customers, carriers and alerts.
- **Scheduled detection service** that runs every 15 minutes and checks three rules, each with per-carrier thresholds:

| Rule | Fires when | Example |
|---|---|---|
| `dwell_sla_breach` | Package keeps getting scanned at the same hub, but has been there longer than the carrier's max dwell time | Stuck at Wuhan Central Hub for 41 h (limit 24 h) |
| `stale_order` | Not delivered, and the carrier has sent no update at all for too long | No update for 52 h (limit 36 h) |
| `cost_deviation` | Billed cost differs from expected cost (weight × rate) by more than the carrier's tolerance | Billed 236.52 vs expected 157.23 (+50.4%) |

- **Priority customers** get 25% stricter time thresholds and their alerts are marked `high` severity.
- **No duplicate alerts:** a partial unique index allows only one unresolved alert per order per rule, so a stuck shipment doesn't create a new alert every 15 minutes.
- **Alert delivery** through a small publisher interface: console by default, AWS SNS by setting one environment variable.

## Architecture

```
 Carriers ──POST /orders/:id/events──►  Express API
                                       routes → controllers → services → repositories
                                                                            │
                                                                       PostgreSQL
                                                                            ▲
 node-cron (every 15 min) ──► detector: 3 rules (INSERT ... SELECT) ────────┘
                                   │ new alerts
                                   ▼
                          AlertPublisher ──► console  /  AWS SNS ──► ops team (email/SMS)
```

Each rule is a single `INSERT ... SELECT` statement, so the filtering happens in PostgreSQL and the app never loads thousands of orders into memory. Every rule takes "now" as a parameter. In production that's the real time; in the replay script it's simulated time, which lets the same code be tested on three weeks of history.

## Data model

| Table | Purpose |
|---|---|
| `carriers` | Carrier info plus its thresholds (`max_dwell_hours`, `stale_after_hours`, `cost_tolerance_pct`) |
| `customers` | Customer company, email, tier (`standard` / `priority`), region |
| `orders` | One shipment: customer, carrier, route, weight, status |
| `shipment_events` | Every status update from a carrier (node, location, time) |
| `billing_records` | Expected vs. billed cost per order |
| `alerts` | Detected anomalies with type, severity, message, JSON details, status |
| `injected_anomalies` | Evaluation only: which anomalies the seed script injected. The detector never reads it |

## Results on the synthetic dataset

`npm run seed` generates 3 weeks of data: 5 carriers, 200 customers, **8,000 orders**, about 49,000 carrier events, and **170 injected anomalies (2.1%)**. `npm run replay` then re-runs the detector every 15 simulated minutes across those 3 weeks (2,016 scans) and compares the alerts with what was injected:

| Rule | Injected | Detected | Avg lag | Max lag |
|---|---|---|---|---|
| cost_deviation | 45 | 45 | 7.1 min | 15 min |
| dwell_sla_breach | 70 | 70 | 6.6 min | 15 min |
| stale_order | 55 | 55 | 7.6 min | 15 min |

- 170 / 170 anomalies detected, 0 false positives
- Every anomaly was flagged within one 15-minute scan cycle of becoming detectable
- 2,016 scans took about 20 seconds

These numbers are on clean synthetic data where normal shipments are clearly below every threshold, so perfect recall is expected. Real carrier data is noisier, which is why thresholds are configurable per carrier.

## Run it

### With Docker

```bash
docker compose up -d --build              # Postgres + API (scheduler runs every 15 min)
docker compose exec api npm run seed      # 3 weeks of synthetic data, ending now
docker compose exec api npm run replay    # replay detection over those 3 weeks
curl "localhost:3000/api/alerts?severity=high"
```

### Without Docker

Requires Node 20+ and a running PostgreSQL.

```bash
npm install
cp .env.example .env        # set DATABASE_URL
npm run seed
npm run replay
npm start                   # API on :3000, detection every 15 min
```

### Tests

```bash
# uses a separate database (shipments_test), created automatically by docker compose
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/shipments_test npm test
```

18 tests cover every rule (including priority thresholds, no duplicates, ignoring future events) and the API (CRUD, validation, status changes, alert acknowledgement).

### Sending real alerts with AWS SNS

Create an SNS topic, subscribe your email to it, then:

```bash
ALERT_PUBLISHER=sns SNS_TOPIC_ARN=arn:aws:sns:us-west-2:123456789012:shipment-alerts \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... docker compose up -d
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check (also pings the database) |
| GET | `/api/orders?status=&carrierId=&customerId=&atRisk=true` | List orders; `atRisk=true` = has an unresolved alert |
| POST | `/api/orders` | Create an order |
| GET | `/api/orders/:id` | Order with its events, billing record and alerts |
| PUT | `/api/orders/:id` | Update destination, weight or status |
| DELETE | `/api/orders/:id` | Delete an order |
| POST | `/api/orders/:id/events` | Carrier status update (`node`, `location`, optional `occurredAt`) |
| GET | `/api/customers/:id/orders?atRisk=true` | A customer's orders |
| GET | `/api/carriers` | Carriers and their thresholds |
| PUT | `/api/carriers/:id/thresholds` | Change a carrier's thresholds |
| GET | `/api/alerts?status=&type=&severity=` | List alerts |
| GET | `/api/alerts/summary` | Alert counts by type, severity and status |
| PUT | `/api/alerts/:id` | Set status to `acknowledged` or `resolved` |
| POST | `/api/scans` | Run a detection scan now |

Example:

```bash
curl -X POST localhost:3000/api/orders/1/events \
  -H 'content-type: application/json' \
  -d '{"node": "transit_hub", "location": "Wuhan Central Hub"}'
```

## Project structure

```
src/
  app.js, server.js        Express app; server also starts the scheduler
  config/                  environment variables
  db/                      connection pool, schema.sql
  routes/                  URL → controller
  controllers/             HTTP in/out only
  services/                validation and business rules
  repositories/            SQL only
  detection/               rules.js (the 3 rules), detector.js, scheduler.js
  alerts/                  console / SNS publishers
scripts/
  migrate.js, seed.js, replay.js
tests/                     Jest + Supertest against a real Postgres
```

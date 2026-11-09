// Tests always use a separate database so they never wipe your seeded data
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://postgres:postgres@localhost:5432/shipments_test';
process.env.PRIORITY_THRESHOLD_FACTOR = '0.75';

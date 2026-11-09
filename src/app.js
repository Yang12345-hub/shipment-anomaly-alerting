const express = require('express');
const routes = require('./routes');
const db = require('./db/pool');
const { notFound, errorHandler } = require('./middleware/errors');

function createApp(publisher) {
  const app = express();
  app.locals.publisher = publisher;
  app.use(express.json());

  app.get('/health', async (req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.use('/api', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;

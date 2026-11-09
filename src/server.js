const config = require('./config');
const createApp = require('./app');
const { createPublisher } = require('./alerts/publishers');
const { startScheduler } = require('./detection/scheduler');

const publisher = createPublisher();
const app = createApp(publisher);

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  if (process.env.DISABLE_SCHEDULER !== 'true') startScheduler(publisher);
});

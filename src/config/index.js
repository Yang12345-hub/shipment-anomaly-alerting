require('dotenv').config({ quiet: true });

const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/shipments',
  port: Number(process.env.PORT || 3000),
  scanCron: process.env.SCAN_CRON || '*/15 * * * *',
  alertPublisher: process.env.ALERT_PUBLISHER || 'console',
  awsRegion: process.env.AWS_REGION || 'us-west-2',
  snsTopicArn: process.env.SNS_TOPIC_ARN || '',
  priorityThresholdFactor: Number(process.env.PRIORITY_THRESHOLD_FACTOR || 0.75),
};

module.exports = config;

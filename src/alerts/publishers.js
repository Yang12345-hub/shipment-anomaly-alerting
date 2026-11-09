// Where alerts go once they are detected. Swapping console <-> SNS is one env variable.
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const config = require('../config');

class ConsolePublisher {
  async publish(alert) {
    console.log(`[ALERT][${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`);
  }
}

class SnsPublisher {
  constructor(topicArn, region) {
    this.topicArn = topicArn;
    this.client = new SNSClient({ region });
  }

  async publish(alert) {
    await this.client.send(new PublishCommand({
      TopicArn: this.topicArn,
      Subject: `[${alert.severity.toUpperCase()}] ${alert.type}`.slice(0, 100),
      Message: JSON.stringify(alert, null, 2),
      MessageAttributes: {
        severity: { DataType: 'String', StringValue: alert.severity },
        type: { DataType: 'String', StringValue: alert.type },
      },
    }));
  }
}

// Used by the replay script: count alerts instead of printing thousands of lines
class CountingPublisher {
  constructor() {
    this.count = 0;
  }

  async publish() {
    this.count += 1;
  }
}

function createPublisher() {
  if (config.alertPublisher === 'sns') {
    if (!config.snsTopicArn) throw new Error('ALERT_PUBLISHER=sns requires SNS_TOPIC_ARN');
    return new SnsPublisher(config.snsTopicArn, config.awsRegion);
  }
  return new ConsolePublisher();
}

module.exports = { ConsolePublisher, SnsPublisher, CountingPublisher, createPublisher };

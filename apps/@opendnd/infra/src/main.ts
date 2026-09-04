import { App, Tags } from 'aws-cdk-lib';
import { stageFrom } from './config';
import { PersistentStack } from './persistent-stack';
import { ServiceStack } from './service-stack';

const app = new App();
const config = stageFrom(app.node.tryGetContext('stage') as string | undefined);

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const persistent = new PersistentStack(
  app,
  `OpenDnD-${config.stage}-Persistent`,
  {
    env,
    config,
    description:
      'OpenDnD: the user pool, the connection secrets and the asset bucket. Outlives the service.',
  },
);

new ServiceStack(app, `OpenDnD-${config.stage}-Service`, {
  env,
  config,
  userPool: persistent.userPool,
  userPoolClient: persistent.userPoolClient,
  databaseSecret: persistent.databaseSecret,
  databaseAdminSecret: persistent.databaseAdminSecret,
  assets: persistent.assets,
  description: 'OpenDnD: the API, the event bus and the outbox publisher.',
});

Tags.of(app).add('project', 'opendnd');
app.synth();

import { beforeAll, describe, expect, it } from 'bun:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PersistentStack, ServiceStack, stageFrom } from 'src';

const env = { account: '123456789012', region: 'us-east-1' };

function build(stageName: string) {
  /*
   * Bundling is off. These assertions are about the template, not about what
   * esbuild produces, and running it would make them slow, need a bundler on
   * the path, and fail for reasons that have nothing to do with the stack.
   * The bundle itself is checked by `cdk synth`.
   */
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const config = stageFrom(stageName);
  const persistent = new PersistentStack(app, 'Persistent', { env, config });
  const service = new ServiceStack(app, 'Service', {
    env,
    config,
    userPool: persistent.userPool,
    userPoolClient: persistent.userPoolClient,
    databaseSecret: persistent.databaseSecret,
    databaseAdminSecret: persistent.databaseAdminSecret,
    assets: persistent.assets,
  });
  return {
    persistent: Template.fromStack(persistent),
    service: Template.fromStack(service),
  };
}

describe('the deployment', () => {
  let persistent: Template;
  let service: Template;

  beforeAll(() => {
    ({ persistent, service } = build('dev'));
  });

  it('runs the API on Lambda behind one HTTP API route', () => {
    service.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    // One route to the application, because the API's own route table is
    // generated from the ontology and mirroring it here would need a
    // deployment for every model added.
    service.resourceCountIs('AWS::ApiGatewayV2::Route', 1);
    service.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'ANY /{proxy+}',
    });
    service.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'opendnd-dev-api',
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
    });
  });

  it('creates no VPC, and so nothing charged by the hour', () => {
    // The database is reached over TLS, which is what keeps a quiet
    // deployment close to free: a NAT gateway is the usual accident.
    service.resourceCountIs('AWS::EC2::VPC', 0);
    service.resourceCountIs('AWS::EC2::NatGateway', 0);
    service.resourceCountIs('AWS::RDS::DBInstance', 0);
    persistent.resourceCountIs('AWS::EC2::VPC', 0);
  });

  it('gives the API the connection URL by reference, never the value', () => {
    const functions = service.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'opendnd-dev-api' },
    });
    const environment = Object.values(functions)[0]!.Properties.Environment
      .Variables as Record<string, unknown>;
    expect(environment.DATABASE_SECRET_ARN).toBeDefined();
    // A URL in an environment variable is readable by anyone who can describe
    // the function, so only the secret's name travels.
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(JSON.stringify(environment)).not.toContain('postgres://');
  });

  it('lets only the migrator reach the owner credentials', () => {
    const policies = service.findResources('AWS::IAM::Policy');
    const named = Object.entries(policies).map(
      ([id, policy]) => [id, JSON.stringify(policy)] as const,
    );
    const admin = named.filter(([, body]) => body.includes('DatabaseAdminUrl'));
    // The owner can read and write anything in any world, because an owner
    // bypasses row-level security. Exactly one role holds it, and it is not
    // one that answers requests.
    expect(admin).toHaveLength(1);
    expect(admin[0]![0]).toContain('Migrator');

    for (const role of ['ApiServiceRole', 'PublisherServiceRole']) {
      const [, body] = named.find(([id]) => id.startsWith(role))!;
      expect(body).toContain('DatabaseUrl');
      expect(body).not.toContain('DatabaseAdminUrl');
    }
  });

  it('throttles at the edge and keeps each container to a small pool', () => {
    service.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({
        ThrottlingRateLimit: 50,
        ThrottlingBurstLimit: 100,
      }),
    });
    service.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'opendnd-dev-api',
      Environment: {
        Variables: Match.objectLike({ PG_POOL_MAX: '2' }),
      },
    });
  });

  it('turns the local-first default off, because a deployment has no Ollama', () => {
    service.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'opendnd-dev-api',
      Environment: {
        Variables: Match.objectLike({ OPENDND_LLM_LOCAL: 'off' }),
      },
    });
  });

  it('lets the API spend on models and nothing else spend at all', () => {
    const policies = service.findResources('AWS::IAM::Policy');
    const bedrock = Object.values(policies).filter((policy) =>
      JSON.stringify(policy).includes('bedrock:InvokeModel'),
    );
    expect(bedrock).toHaveLength(1);
    expect(JSON.stringify(bedrock[0])).toContain('ApiServiceRole');
  });

  it('drains the outbox on a schedule rather than on each write', () => {
    service.resourceCountIs('AWS::Events::EventBus', 1);
    service.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 minute)',
      State: 'ENABLED',
    });
    service.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'opendnd-dev-publisher',
    });
  });

  it('does not schedule or expose the migrator', () => {
    // A schema change is not something to have happen as a side effect of
    // shipping code, so it is invoked deliberately and by nothing else.
    const rules = service.findResources('AWS::Events::Rule');
    expect(JSON.stringify(rules)).not.toContain('migrator');
    const permissions = service.findResources('AWS::Lambda::Permission');
    expect(JSON.stringify(permissions)).not.toContain('Migrator');
  });

  it('keeps every log group, with a retention', () => {
    service.resourceCountIs('AWS::Logs::LogGroup', 3);
    service.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 30,
    });
  });

  it('sets up a user pool a browser can sign in to without a secret', () => {
    persistent.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'opendnd-dev',
      UsernameAttributes: ['email'],
      AutoVerifiedAttributes: ['email'],
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
    });
    persistent.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  it('blocks public access to the asset bucket and requires TLS', () => {
    persistent.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    const policies = persistent.findResources('AWS::S3::BucketPolicy');
    expect(JSON.stringify(policies)).toContain('aws:SecureTransport');
  });

  it('publishes what a client needs to reach it', () => {
    const outputs = {
      ...persistent.toJSON().Outputs,
      ...service.toJSON().Outputs,
    };
    const keys = Object.keys(outputs);
    for (const wanted of [
      'UserPoolId',
      'UserPoolClientId',
      'ApiUrl',
      'MigratorFunction',
    ]) {
      expect(keys.some((k) => k.startsWith(wanted))).toBe(true);
    }
  });
});

describe('a production stage', () => {
  it('will not let a deployment delete what holds accounts or data', () => {
    const { persistent } = build('prod');
    // A rolled-back deployment must not be able to take the user pool, and
    // therefore every account in it, with it.
    persistent.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    persistent.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    persistent.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('refuses a stage the repository does not define', () => {
    expect(() => stageFrom('staging')).toThrow('not a stage');
    expect(stageFrom(undefined).stage).toBe('dev');
  });
});

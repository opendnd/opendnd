import { join } from 'node:path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Tags,
} from 'aws-cdk-lib';
import {
  CfnStage,
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { EventBus, Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import {
  NodejsFunction,
  OutputFormat,
  type NodejsFunctionProps,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Bucket } from 'aws-cdk-lib/aws-s3';
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';

export interface ServiceStackProps extends StackProps {
  readonly config: StageConfig;
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly databaseSecret: Secret;
  readonly databaseAdminSecret: Secret;
  readonly assets: Bucket;
}

/** Where the API's Lambda entry points live, relative to this file. */
const API_SRC = join(__dirname, '..', '..', 'api', 'src', 'lambda');
const MIGRATIONS = join(__dirname, '..', '..', 'api', 'migrations');

/**
 * The parts of a deployment that can be replaced.
 *
 * There is no VPC. The database is a managed endpoint reached over TLS, so
 * the functions run outside one and reach Cognito, Bedrock and Postgres
 * directly, which is what keeps a quiet deployment close to free: no NAT
 * gateway, no interface endpoints, nothing charged by the hour.
 */
export class ServiceStack extends Stack {
  readonly api: HttpApi;
  readonly bus: EventBus;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);
    const { config, databaseSecret, databaseAdminSecret, assets } = props;

    this.bus = new EventBus(this, 'Bus', {
      eventBusName: `opendnd-${config.stage}`,
    });

    const environment: Record<string, string> = {
      NODE_OPTIONS: '--enable-source-maps',
      DATABASE_SECRET_ARN: databaseSecret.secretArn,
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      COGNITO_CLIENT_IDS: props.userPoolClient.userPoolClientId,
      EVENT_BUS_NAME: this.bus.eventBusName,
      ASSETS_BUCKET: assets.bucketName,
      // Every warm container holds its own pool against one database, so
      // each keeps few connections and gives up quickly when none is free.
      PG_POOL_MAX: '2',
      // A deployment has no Ollama on the box, so the local-first default
      // would find nothing. Bedrock serves it instead.
      OPENDND_LLM_LOCAL: 'off',
      ...(config.defaultModel
        ? { OPENDND_LLM_MODEL: config.defaultModel }
        : {}),
    };

    const shared: Partial<NodejsFunctionProps> = {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      environment,
      bundling: {
        format: OutputFormat.CJS,
        sourceMap: true,
        target: 'node22',
        /*
         * `pg` reaches for an optional native client and for a Cloudflare
         * socket module, neither of which exists here; the AWS SDK is on the
         * runtime already, so bundling a second copy would only make the
         * package larger and the cold start longer.
         */
        externalModules: ['@aws-sdk/*', 'pg-native', 'cloudflare:sockets'],
      },
    };

    /**
     * A log group per function, declared rather than left to Lambda.
     *
     * Created implicitly, a log group has no retention and keeps everything
     * for ever, which costs money quietly; it also survives the function,
     * so a redeployment inherits a group it does not own.
     */
    const logs = (name: string) =>
      new LogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/opendnd-${config.stage}-${name.toLowerCase()}`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const api = new NodejsFunction(this, 'Api', {
      ...shared,
      logGroup: logs('Api'),
      functionName: `opendnd-${config.stage}-api`,
      entry: join(API_SRC, 'api.ts'),
      timeout: Duration.seconds(29),
      description: 'The OpenDnD API.',
    });

    const publisher = new NodejsFunction(this, 'Publisher', {
      ...shared,
      logGroup: logs('Publisher'),
      functionName: `opendnd-${config.stage}-publisher`,
      entry: join(API_SRC, 'publish.ts'),
      timeout: Duration.minutes(2),
      description: 'Drains the event outbox onto the bus.',
    });

    /*
     * Migrations run as the database owner, so this function is the only one
     * given that secret, and it is invoked deliberately rather than on
     * deployment. The migration files are copied in beside the bundle,
     * because they are read at run time and esbuild does not follow SQL.
     */
    const migrator = new NodejsFunction(this, 'Migrator', {
      ...shared,
      logGroup: logs('Migrator'),
      functionName: `opendnd-${config.stage}-migrator`,
      entry: join(API_SRC, 'migrate.ts'),
      timeout: Duration.minutes(5),
      description: 'Applies the SQL migrations. Invoke it deliberately.',
      environment: {
        ...environment,
        DATABASE_ADMIN_SECRET_ARN: databaseAdminSecret.secretArn,
      },
      bundling: {
        ...shared.bundling,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_input: string, output: string) => [
            `mkdir -p ${output}/migrations`,
            `cp ${MIGRATIONS}/*.sql ${output}/migrations/`,
          ],
        },
      },
    });

    databaseSecret.grantRead(api);
    databaseSecret.grantRead(publisher);
    databaseSecret.grantRead(migrator);
    databaseAdminSecret.grantRead(migrator);
    this.bus.grantPutEventsTo(publisher);
    assets.grantReadWrite(api);

    // Model calls are the API's, and the only ones. A function that does not
    // answer requests has no reason to be able to spend on tokens.
    api.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
        ],
        resources: (config.bedrockModels ?? ['*']).map((model) =>
          model === '*'
            ? `arn:aws:bedrock:${this.region}::foundation-model/*`
            : `arn:aws:bedrock:${this.region}::foundation-model/${model}`,
        ),
      }),
    );

    this.api = new HttpApi(this, 'HttpApi', {
      apiName: `opendnd-${config.stage}`,
      description: 'The OpenDnD API.',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });

    /*
     * One route to the application rather than a route per model.
     *
     * The API's own route table is generated from the ontology, so mirroring
     * it in the gateway would mean a deployment for every model added and two
     * descriptions of the same thing that could disagree. Authorization is
     * the application's too: it depends on the caller's role in the world
     * being addressed, which a gateway authorizer cannot know.
     */
    this.api.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', api),
    });

    // Throttled at the edge, so a flood is turned away before it costs a
    // function invocation. The construct has no property for it; the stage
    // resource does.
    const stage = this.api.defaultStage?.node.defaultChild as
      CfnStage | undefined;
    stage?.addPropertyOverride('DefaultRouteSettings', {
      ThrottlingRateLimit: config.throttle?.rate ?? 50,
      ThrottlingBurstLimit: config.throttle?.burst ?? 100,
    });

    new Rule(this, 'PublishSchedule', {
      ruleName: `opendnd-${config.stage}-publish`,
      description: 'Drains the event outbox.',
      schedule: Schedule.rate(
        Duration.minutes(config.publishEveryMinutes ?? 1),
      ),
      targets: [new LambdaFunction(publisher, { retryAttempts: 2 })],
    });

    Tags.of(this).add('project', 'opendnd');
    Tags.of(this).add('stage', config.stage);

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
    new CfnOutput(this, 'EventBusName', { value: this.bus.eventBusName });
    new CfnOutput(this, 'MigratorFunction', {
      value: migrator.functionName,
      description: 'Invoke this to apply migrations.',
    });
  }
}

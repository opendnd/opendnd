import {
  CfnOutput,
  RemovalPolicy,
  Stack,
  type StackProps,
  Duration,
} from 'aws-cdk-lib';
import {
  AccountRecovery,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolDomain,
} from 'aws-cdk-lib/aws-cognito';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';

export interface PersistentStackProps extends StackProps {
  readonly config: StageConfig;
}

/**
 * The parts of a deployment that hold something.
 *
 * They are a stack of their own because they must outlive the code that uses
 * them: a rolled-back service deployment must not be able to take the user
 * pool, and therefore every account in it, with it. Nothing here is replaced
 * by shipping a new version of the API.
 */
export class PersistentStack extends Stack {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  /** Connection URL for the role the API serves as. */
  readonly databaseSecret: Secret;
  /** Connection URL for the owner, used by migrations and by nothing else. */
  readonly databaseAdminSecret: Secret;
  readonly assets: Bucket;

  constructor(scope: Construct, id: string, props: PersistentStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removalPolicy = config.destroyable
      ? RemovalPolicy.DESTROY
      : RemovalPolicy.RETAIN;

    this.userPool = new UserPool(this, 'Users', {
      userPoolName: `opendnd-${config.stage}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 12, requireSymbols: false },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });

    this.userPoolClient = this.userPool.addClient('Web', {
      userPoolClientName: 'web',
      // A public client with no secret, for a browser application: the code
      // grant with PKCE, which is the only flow safe without one.
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        ...(config.callbackUrls
          ? { callbackUrls: [...config.callbackUrls] }
          : {}),
        ...(config.logoutUrls ? { logoutUrls: [...config.logoutUrls] } : {}),
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    if (config.cognitoDomainPrefix) {
      new UserPoolDomain(this, 'Domain', {
        userPool: this.userPool,
        cognitoDomain: { domainPrefix: config.cognitoDomainPrefix },
      });
    }

    /*
     * The database is not created here.
     *
     * Postgres is served by Neon, which is not a CloudFormation resource, and
     * that is the point: a managed endpoint reached over TLS means the
     * functions need no VPC, and therefore no NAT gateway, which is the
     * largest fixed cost a small serverless deployment can accidentally take
     * on. What the stack creates is somewhere to put the two connection URLs;
     * the values are set out of band, once.
     */
    this.databaseSecret = new Secret(this, 'DatabaseUrl', {
      secretName: `opendnd/${config.stage}/database-url`,
      description:
        'Postgres URL for the role the API serves as. Must not be the owner: an owner bypasses the row-level security that separates worlds.',
      removalPolicy,
    });
    this.databaseAdminSecret = new Secret(this, 'DatabaseAdminUrl', {
      secretName: `opendnd/${config.stage}/database-admin-url`,
      description:
        'Postgres URL for the owner. Used by migrations and by nothing that serves a request.',
      removalPolicy,
    });

    this.assets = new Bucket(this, 'Assets', {
      bucketName: `opendnd-${config.stage}-assets-${this.account}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: !config.destroyable,
      removalPolicy,
      autoDeleteObjects: config.destroyable,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['range', 'if-match'],
          exposedHeaders: ['etag', 'content-range', 'content-length'],
          maxAge: 3600,
        },
      ],
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'AssetsBucket', { value: this.assets.bucketName });
    new CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecret.secretArn,
    });
  }
}

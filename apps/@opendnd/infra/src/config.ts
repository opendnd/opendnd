/** What differs between one deployment and another. */
export interface StageConfig {
  /** Short name used in resource names and stack ids: `dev`, `prod`. */
  readonly stage: string;
  /**
   * Where the API's model calls go. Left unset the API is local-first and a
   * deployment has no local Ollama, so nothing would answer: a deployment
   * should name a Bedrock model.
   */
  readonly defaultModel?: string;
  /** Bedrock model ids the function may invoke. `*` for any in the region. */
  readonly bedrockModels?: readonly string[];
  /** Callback URLs for the hosted sign-in flow. */
  readonly callbackUrls?: readonly string[];
  readonly logoutUrls?: readonly string[];
  /** Prefix of the Cognito hosted domain, which must be unique in the region. */
  readonly cognitoDomainPrefix?: string;
  /** How often the outbox is drained, in minutes. */
  readonly publishEveryMinutes?: number;
  /** Whether a deployment may delete the bucket and the user pool with it. */
  readonly destroyable?: boolean;
  /**
   * Requests per second the gateway lets through, and the burst above it.
   * Default 50 and 100. This is the only thing between an anonymous
   * generation request and the function's processor time.
   */
  readonly throttle?: { readonly rate: number; readonly burst: number };
}

export const DEFAULT_STAGE: StageConfig = {
  stage: 'dev',
  bedrockModels: ['*'],
  publishEveryMinutes: 1,
  destroyable: true,
};

/**
 * The stage to deploy, from CDK context: `cdk deploy -c stage=prod`.
 *
 * A stage that is not named here is refused rather than guessed at, because
 * the difference between one stage and another includes whether its data can
 * be deleted.
 */
export const STAGES: Record<string, StageConfig> = {
  dev: DEFAULT_STAGE,
  prod: {
    stage: 'prod',
    bedrockModels: ['*'],
    publishEveryMinutes: 1,
    destroyable: false,
  },
};

export function stageFrom(name: string | undefined): StageConfig {
  const stage = STAGES[name ?? 'dev'];
  if (!stage) {
    throw new Error(
      `${name} is not a stage this repository defines; add it to STAGES. Known: ${Object.keys(STAGES).join(', ')}`,
    );
  }
  return stage;
}

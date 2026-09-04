import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

/**
 * The database URL.
 *
 * `DATABASE_URL` wins when it is set, which is how the API runs locally and
 * in a test. In a deployment the URL is a secret rather than an environment
 * variable, so only its identifier is on the function and the value is
 * fetched once per cold start and held for the life of the container.
 */
export async function databaseUrl(
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const arn = env.DATABASE_SECRET_ARN;
  if (!arn) return undefined;
  return secretString(arn, env.AWS_REGION);
}

let client: SecretsManagerClient | undefined;

export async function secretString(
  secretId: string,
  region?: string,
): Promise<string | undefined> {
  client ??= new SecretsManagerClient(region ? { region } : {});
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (SecretString === undefined) return undefined;
  // A secret written by hand is a bare URL; one written by a console or a
  // rotation is usually JSON. Both are accepted.
  if (!SecretString.trimStart().startsWith('{')) return SecretString;
  try {
    const parsed = JSON.parse(SecretString) as Record<string, string>;
    return parsed.url ?? parsed.DATABASE_URL ?? parsed.connectionString;
  } catch {
    return SecretString;
  }
}

/**
 * LocalStack coverage for Archviz palette nodes.
 * Hobby (no token / community pin) vs paid entitlements (auth token) — see docs/localstack.md.
 */

/** Palette types expected to apply cleanly on LocalStack Hobby / community 4.14. */
export const LOCALSTACK_HOBBY_TYPES: ReadonlySet<string> = new Set([
  'aws/lambda-function',
  'aws/dynamodb-table',
  'aws/s3-bucket',
  'aws/sqs-queue',
  'aws/sns-topic',
  'aws/iam-role',
  'aws/cloudwatch-log-group',
  'aws/ssm-parameter',
  'aws/secrets-manager-secret',
  'aws/api-gateway-http-api',
  'aws/vpc',
  'aws/subnet',
  'aws/security-group',
  'aws/internet-gateway',
]);

/**
 * Types that typically need LocalStack Ultimate (or a trial / OSS sponsorship).
 * Allowed when LOCALSTACK_AUTH_TOKEN is configured (paid entitlements).
 */
export const LOCALSTACK_ULTIMATE_HINT_TYPES: ReadonlySet<string> = new Set([
  'aws/ecs-cluster',
  'aws/ecs-service',
  'aws/ecs-task-definition',
  'aws/ecr-repository',
  'aws/rds-instance',
  'aws/aurora-cluster',
  'aws/aurora-cluster-instance',
  'aws/elasticache-cluster',
  'aws/alb',
  'aws/nlb',
  'aws/target-group',
  'aws/ec2-instance',
]);

export const LOCALSTACK_UPGRADE_HINT =
  'These services need LocalStack Ultimate (trial or paid) or an OSS sponsorship. Set LOCALSTACK_AUTH_TOKEN in .env and restart pnpm runner — see https://www.localstack.cloud/pricing and docs/localstack.md';

export interface HobbyCompatibility {
  ok: boolean;
  unsupported: string[];
  ultimateHints: string[];
  message: string | null;
  /** True when the check used paid/token entitlements (Hobby ∪ Ultimate types). */
  paidEntitlements: boolean;
}

export interface LocalstackCompatibilityOptions {
  /**
   * When true (LOCALSTACK_AUTH_TOKEN set), allow Ultimate-hint palette types
   * in addition to Hobby.
   */
  paidEntitlements?: boolean;
}

function allowedTypes(paidEntitlements: boolean): ReadonlySet<string> {
  if (!paidEntitlements) return LOCALSTACK_HOBBY_TYPES;
  return new Set([...LOCALSTACK_HOBBY_TYPES, ...LOCALSTACK_ULTIMATE_HINT_TYPES]);
}

/** Returns whether every resource type is allowed for the current LocalStack tier. */
export function checkLocalstackHobbyCompatibility(
  resourceTypes: string[],
  options: LocalstackCompatibilityOptions = {},
): HobbyCompatibility {
  const paidEntitlements = Boolean(options.paidEntitlements);
  const unique = [...new Set(resourceTypes.filter(Boolean))];
  const allowed = allowedTypes(paidEntitlements);
  const unsupported = unique.filter((t) => !allowed.has(t));
  if (unsupported.length === 0) {
    return {
      ok: true,
      unsupported: [],
      ultimateHints: [],
      message: null,
      paidEntitlements,
    };
  }
  const ultimateHints = unsupported.filter((t) => LOCALSTACK_ULTIMATE_HINT_TYPES.has(t));
  const message = paidEntitlements
    ? `LocalStack paid entitlements still do not list: ${unsupported.join(', ')}. Remove them or extend the allowlist in provider-aws.`
    : [`LocalStack Hobby does not cover: ${unsupported.join(', ')}.`, LOCALSTACK_UPGRADE_HINT].join(
        ' ',
      );
  return { ok: false, unsupported, ultimateHints, message, paidEntitlements };
}
